import { lstat, open, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { AgentItem, ProjectGitStatus } from "@codexly/protocol";

import { GitCommandOutputLimitError, type GitCommandExecutor } from "./git-command.js";

export type GitFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number];
export type GitWorkingTreeChanges = Pick<ProjectGitStatus, "staged" | "unstaged">;

export type WorkingTreeEntry = Readonly<{
  indexStatus: string;
  path: string;
  workingTreeStatus: string;
}>;

export const MAX_GIT_COMMAND_CONCURRENCY = 4;
export const MAX_FILE_IO_CONCURRENCY = 8;
const MAX_WORKING_TREE_DIFF_BYTES = 10 * 1024 * 1024;
export const MAX_WORKING_TREE_FILES = 1_000;
const MAX_UNTRACKED_DIFF_BYTES = 5 * 1024 * 1024;

export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  maxConcurrency: number,
  mapper: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    async (): Promise<void> => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item !== undefined) {
          results[currentIndex] = await mapper(item, currentIndex);
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export class WorkingTreeReadBudget {
  #remainingDiffBytes = MAX_WORKING_TREE_DIFF_BYTES;
  #remainingFiles = MAX_WORKING_TREE_FILES;

  takeEntries(entries: readonly WorkingTreeEntry[]): readonly WorkingTreeEntry[] {
    const selectedEntries = entries.slice(0, this.#remainingFiles);
    this.#remainingFiles -= selectedEntries.length;
    return selectedEntries;
  }

  takeDiff(diff: string): string {
    const bytes = Buffer.byteLength(diff);
    if (bytes > this.#remainingDiffBytes) {
      this.#remainingDiffBytes = 0;
      return "";
    }
    this.#remainingDiffBytes -= bytes;
    return diff;
  }

  get hasDiffCapacity(): boolean {
    return this.#remainingDiffBytes > 0;
  }

  get hasFileCapacity(): boolean {
    return this.#remainingFiles > 0;
  }
}

export function parsePorcelainStatus(
  output: string,
  maxEntries = Number.POSITIVE_INFINITY,
): readonly WorkingTreeEntry[] {
  const records = output.split("\0");
  const entries: WorkingTreeEntry[] = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    if (record === undefined || record.length < 4) {
      continue;
    }
    const indexStatus = record[0] ?? " ";
    const workingTreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    entries.push({ indexStatus, path, workingTreeStatus });

    if (entries.length >= maxEntries) {
      break;
    }

    // Porcelain -z 会在重命名或复制记录后追加旧路径，本功能只展示新路径。
    if (
      indexStatus === "R" ||
      indexStatus === "C" ||
      workingTreeStatus === "R" ||
      workingTreeStatus === "C"
    ) {
      recordIndex += 1;
    }
  }

  return entries;
}

export function resolveChangeKind(status: string): GitFileChange["kind"] {
  if (status === "A" || status === "?") {
    return "create";
  }
  if (status === "D") {
    return "delete";
  }
  return "update";
}

export async function createUntrackedFileDiff(
  projectRoot: string,
  path: string,
): Promise<GitFileChange> {
  const absolutePath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new TypeError("Git file path escapes the project root");
  }
  const createOmittedDiff = (): GitFileChange => ({
    diff: `--- /dev/null\n+++ b/${path}\nBinary files /dev/null and b/${path} differ`,
    kind: "create",
    path,
  });
  const fileStats = await lstat(absolutePath);
  if (fileStats.size > MAX_UNTRACKED_DIFF_BYTES) {
    return createOmittedDiff();
  }

  if (fileStats.isSymbolicLink()) {
    return {
      diff: createUntrackedTextDiff(path, Buffer.from(await readlink(absolutePath), "utf8")),
      kind: "create",
      path,
    };
  }

  const fileHandle = await open(absolutePath, "r");
  let content: Buffer;
  try {
    const openedStats = await fileHandle.stat();
    if (
      !openedStats.isFile() ||
      openedStats.dev !== fileStats.dev ||
      openedStats.ino !== fileStats.ino ||
      openedStats.size > MAX_UNTRACKED_DIFF_BYTES
    ) {
      return createOmittedDiff();
    }

    // 只读取打开时确认的字节数，并在读取后复验大小，避免文件并发增长绕过 5 MiB 上限。
    const buffer = Buffer.allocUnsafe(openedStats.size);
    let totalBytesRead = 0;
    while (totalBytesRead < buffer.length) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        totalBytesRead,
        buffer.length - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytesRead += bytesRead;
    }
    const finalStats = await fileHandle.stat();
    if (finalStats.size !== openedStats.size || totalBytesRead !== openedStats.size) {
      return createOmittedDiff();
    }
    content = buffer;
  } finally {
    await fileHandle.close();
  }
  if (content.includes(0)) {
    return createOmittedDiff();
  }

  return { diff: createUntrackedTextDiff(path, content), kind: "create", path };
}

function createUntrackedTextDiff(path: string, content: Buffer): string {
  const text = content.toString("utf8");
  const contentLines = text.length === 0 ? [] : text.replace(/\n$/u, "").split("\n");
  const hunk = `@@ -0,0 +1,${String(contentLines.length)} @@`;
  return [`--- /dev/null`, `+++ b/${path}`, hunk, ...contentLines.map((line) => `+${line}`)].join(
    "\n",
  );
}

export function applyDiffBudget(
  changes: readonly GitFileChange[],
  budget: WorkingTreeReadBudget,
): GitFileChange[] {
  return changes.map((change) => ({ ...change, diff: budget.takeDiff(change.diff) }));
}

function parseTrackedDiffs(output: string): ReadonlyMap<string, string> {
  if (output === "") {
    return new Map();
  }
  const patchSeparatorIndex = output.indexOf("\0\0");
  if (patchSeparatorIndex < 0) {
    throw new Error("Git diff output is missing raw patch metadata");
  }

  // `--patch-with-raw -z` 的 raw 区使用 NUL 保留原始路径；按其顺序关联 patch，避免解析转义后的标题路径。
  const rawTokens = output.slice(0, patchSeparatorIndex).split("\0");
  const paths: string[] = [];
  for (let tokenIndex = 0; tokenIndex < rawTokens.length;) {
    const metadata = rawTokens[tokenIndex];
    const firstPath = rawTokens[tokenIndex + 1];
    if (metadata === undefined || !metadata.startsWith(":") || firstPath === undefined) {
      throw new Error("Git diff raw metadata is malformed");
    }
    tokenIndex += 2;

    const status = / ([A-Z])[0-9]*$/u.exec(metadata)?.[1];
    if (status === "R" || status === "C") {
      const destinationPath = rawTokens[tokenIndex];
      if (destinationPath === undefined) {
        throw new Error("Git diff rename metadata is missing a destination path");
      }
      paths.push(destinationPath);
      tokenIndex += 1;
    } else {
      paths.push(firstPath);
    }
  }

  const patchOutput = output.slice(patchSeparatorIndex + 2);
  const patches = patchOutput === "" ? [] : patchOutput.split(/(?=^diff --(?:git|cc|combined) )/mu);
  if (patches.length !== paths.length) {
    throw new Error("Git diff patch count does not match raw metadata");
  }

  return new Map(paths.map((path, index) => [path, patches[index] ?? ""]));
}

export async function readTrackedFileChanges(
  projectRoot: string,
  entries: readonly WorkingTreeEntry[],
  location: "staged" | "unstaged",
  gitCommandExecutor: GitCommandExecutor,
): Promise<GitFileChange[]> {
  if (entries.length === 0) {
    return [];
  }

  const createChanges = (
    selectedEntries: readonly WorkingTreeEntry[],
    diffs: ReadonlyMap<string, string> = new Map(),
  ): GitFileChange[] =>
    selectedEntries.map((entry) => ({
      diff: diffs.get(entry.path) ?? "",
      kind: resolveChangeKind(location === "staged" ? entry.indexStatus : entry.workingTreeStatus),
      path: entry.path,
    }));

  const readBatch = async (
    selectedEntries: readonly WorkingTreeEntry[],
  ): Promise<GitFileChange[]> => {
    try {
      const output = await gitCommandExecutor(projectRoot, [
        "diff",
        ...(location === "staged" ? ["--cached"] : []),
        "--no-color",
        "--no-ext-diff",
        "--patch-with-raw",
        "-z",
        "--",
        ...selectedEntries.map((entry) => `:(literal)${entry.path}`),
      ]);
      return createChanges(selectedEntries, parseTrackedDiffs(output));
    } catch (error) {
      if (!(error instanceof GitCommandOutputLimitError)) {
        throw error;
      }
      if (selectedEntries.length === 1) {
        // 单文件仍超过命令上限时只省略正文，保留路径和变更类型供摘要生成。
        return createChanges(selectedEntries);
      }

      const middle = Math.ceil(selectedEntries.length / 2);
      // 顺序拆分控制峰值内存；任一子批次成功后仍可提供代表性 diff。
      const left = await readBatch(selectedEntries.slice(0, middle));
      const right = await readBatch(selectedEntries.slice(middle));
      return [...left, ...right];
    }
  };

  return readBatch(entries);
}
