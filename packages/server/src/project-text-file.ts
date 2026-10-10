import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MAX_TEXT_FILE_BYTES,
  type ProjectTextFile,
  type ProjectTextFileRevision,
  type SaveProjectTextFileRequest,
  type SaveProjectTextFileResponse,
} from "@codexly/protocol";

export class TextFileError extends Error {
  constructor(
    public readonly code: "TEXT_FILE_CONFLICT" | "TEXT_FILE_UNSUPPORTED",
    message: string,
  ) {
    super(message);
  }
}
const unsupported = () =>
  new TextFileError(
    "TEXT_FILE_UNSUPPORTED",
    "Only project UTF-8 text files up to 2 MiB with consistent line endings can be edited",
  );
const conflict = () =>
  new TextFileError("TEXT_FILE_CONFLICT", "File changed on disk; reload before saving");
const blockedExtensions = new Set([
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".pdf",
  ".zip",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".woff",
  ".woff2",
]);
const saves = new Map<string, Promise<unknown>>();
const versionOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const revisionOf = (stat: BigIntStats) =>
  createHash("sha256")
    .update([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(":"))
    .digest("hex");

export async function readProjectTextFileRevision(
  root: string,
  path: string,
): Promise<ProjectTextFileRevision> {
  const { target } = await resolveTarget(root, path);
  // 只检查元数据，不读取或哈希正文；ctime 与文件身份可识别同长度写入和原子替换。
  const stat = await lstat(target, { bigint: true });
  if (!stat.isFile() || stat.size > BigInt(MAX_TEXT_FILE_BYTES)) throw unsupported();
  return { revision: revisionOf(stat) };
}

async function resolveTarget(root: string, requestedPath: string) {
  const canonicalRoot = await realpath(root);
  const path = isAbsolute(requestedPath)
    ? relative(
        requestedPath.startsWith(`${resolve(root)}${sep}`) ? resolve(root) : canonicalRoot,
        requestedPath,
      )
    : requestedPath;
  const segments = path.split(/[\\/]/u);
  if (
    !path ||
    isAbsolute(path) ||
    segments.some(
      (s) => !s || s === "." || s === ".." || s.toLowerCase() === ".git" || s.includes(":"),
    )
  )
    throw unsupported();
  let target = canonicalRoot;
  // 编辑权限比只读引用更严格：逐段拒绝符号链接，禁止越过项目根目录。
  for (const segment of segments) {
    target = resolve(target, segment);
    if ((await lstat(target)).isSymbolicLink()) throw unsupported();
  }
  if (blockedExtensions.has(extname(target).toLowerCase())) throw unsupported();
  return { target, path: relative(canonicalRoot, target).split(sep).join("/") };
}

function decodeText(bytes: Buffer): string {
  if (bytes.length > MAX_TEXT_FILE_BYTES) throw unsupported();
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw unsupported();
  }
  // 防止二进制误判和编辑器规范化混合换行后悄悄改写整份文件。
  if (
    bytes.some((byte) => byte <= 8 || byte === 11 || byte === 12 || (byte >= 14 && byte <= 31)) ||
    /\r(?!\n)/u.test(content) ||
    (content.includes("\r\n") && /(?<!\r)\n/u.test(content))
  )
    throw unsupported();
  return content;
}

async function snapshot(target: string) {
  const handle = await open(target, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_TEXT_FILE_BYTES)) throw unsupported();
    // 有界读取，即使文件在 stat 后增长也不会无限分配内存。
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      BigInt(length) !== before.size ||
      revisionOf(after) !== revisionOf(before) ||
      revisionOf(await lstat(target, { bigint: true })) !== revisionOf(before)
    )
      throw conflict();
    const bytes = buffer.subarray(0, length);
    return {
      content: decodeText(bytes),
      version: versionOf(bytes),
      revision: revisionOf(before),
      mode: Number(before.mode),
      ino: before.ino,
      dev: before.dev,
    };
  } finally {
    await handle.close();
  }
}

export async function readProjectTextFile(root: string, path: string): Promise<ProjectTextFile> {
  const resolved = await resolveTarget(root, path);
  const data = await snapshot(resolved.target);
  return {
    path: resolved.path,
    content: data.content,
    version: data.version,
    revision: data.revision,
  };
}

export async function saveProjectTextFile(
  root: string,
  input: SaveProjectTextFileRequest,
): Promise<SaveProjectTextFileResponse> {
  const { target } = await resolveTarget(root, input.path);
  const bytes = Buffer.from(input.content, "utf8");
  if (decodeText(bytes) !== input.content) throw unsupported();
  const previous = saves.get(target) ?? Promise.resolve();
  // 同一文件的保存串行化，后来的旧版本写入必须失败；队列结束即释放引用。
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const original = await snapshot(target);
      if (original.version !== input.expectedVersion) throw conflict();
      const temporary = join(dirname(target), `.codexly-edit-${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.chmod(original.mode & 0o777);
        await handle.sync();
        const submitted = await handle.stat({ bigint: true });
        await resolveTarget(root, input.path);
        const latest = await snapshot(target);
        if (
          latest.version !== original.version ||
          latest.ino !== original.ino ||
          latest.dev !== original.dev
        )
          throw conflict();
        // 同目录原子替换，不先截断原文件；失败时原内容仍然可用。
        await rename(temporary, target);
        // 回执仅绑定本次写入：重命名后检查句柄与目标身份，迟到的外部替换不得标为已缓存。
        const written = await handle.stat({ bigint: true }).catch(() => null);
        // 原子保存已经成功，附加缓存信息失败不能把成功写入误报为保存失败。
        const current = await lstat(target, { bigint: true }).catch(() => null);
        return {
          version: versionOf(bytes),
          ...(written !== null &&
          current !== null &&
          written.size === submitted.size &&
          written.mtimeNs === submitted.mtimeNs &&
          revisionOf(written) === revisionOf(current)
            ? { revision: revisionOf(written) }
            : {}),
        };
      } finally {
        await handle.close();
        await unlink(temporary).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    });
  saves.set(target, operation);
  try {
    return await operation;
  } finally {
    if (saves.get(target) === operation) saves.delete(target);
  }
}
