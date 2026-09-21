import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { Readable } from "node:stream";

export type ProjectFileDownload = Readonly<{
  content: Readable;
  name: string;
}>;

export async function readProjectFileDownload(
  projectRoot: string,
  requestedPath: string,
): Promise<ProjectFileDownload> {
  if (!isAbsolute(projectRoot) || requestedPath.length === 0) {
    throw new TypeError("Project root and download path must be valid");
  }

  const resolvedProjectRoot = await realpath(projectRoot);
  // Agent 生成文件可能位于 Project 外；绝对路径直接读取，相对路径以任务工作目录解析。
  const candidatePath = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(resolvedProjectRoot, requestedPath);
  const resolvedFilePath = await realpath(candidatePath);
  if (!(await stat(resolvedFilePath)).isFile()) {
    throw new TypeError("Download path is not a regular file");
  }

  return { content: createReadStream(resolvedFilePath), name: basename(resolvedFilePath) };
}

export function createAttachmentContentDisposition(name: string): string {
  // 固定 ASCII 回退名，并通过 RFC 5987 参数保留中文等 Unicode 文件名。
  const encodedName = encodeURIComponent(name).replace(
    /['()]/gu,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`,
  );
  return `attachment; filename="download"; filename*=UTF-8''${encodedName}`;
}
