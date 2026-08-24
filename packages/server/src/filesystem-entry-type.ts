import type { Dirent } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

export type FilesystemEntryType = "directory" | "file" | "other" | "symbolic-link";

export type ClassifiedFilesystemEntry = Readonly<{
  entry: Dirent;
  type: FilesystemEntryType;
}>;

type FilesystemEntryMetadata = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}>;

type ReadFilesystemEntryMetadata = (path: string) => Promise<FilesystemEntryMetadata>;

function typeFromMetadata(metadata: FilesystemEntryMetadata): FilesystemEntryType {
  if (metadata.isSymbolicLink()) return "symbolic-link";
  if (metadata.isDirectory()) return "directory";
  if (metadata.isFile()) return "file";
  return "other";
}

export async function classifyFilesystemEntry(
  path: string,
  entry: FilesystemEntryMetadata,
  readMetadata: ReadFilesystemEntryMetadata = lstat,
): Promise<FilesystemEntryType> {
  if (!entry.isSymbolicLink()) return typeFromMetadata(entry);

  // Windows 会把云盘 reparse point 枚举为 link；lstat 可继续区分云盘目录与真实 symlink。
  return typeFromMetadata(await readMetadata(path));
}

export async function classifyFilesystemEntries(
  directoryPath: string,
  entries: readonly Dirent[],
): Promise<ClassifiedFilesystemEntry[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      entry,
      type: await classifyFilesystemEntry(join(directoryPath, entry.name), entry),
    })),
  );
}
