import type { Dirent } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import type { ProjectDirectoryListing } from "@code-agent/protocol";

import { classifyFilesystemEntries } from "./filesystem-entry-type.js";
import { listFilesystemRoots } from "./filesystem-roots.js";

export type ProjectDirectoryBrowserErrorReason = "directory-unavailable" | "invalid-directory";

export class ProjectDirectoryBrowserError extends Error {
  public constructor(
    message: string,
    public readonly reason: ProjectDirectoryBrowserErrorReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectDirectoryBrowserError";
  }
}

type ProjectDirectoryBrowserOptions = Readonly<{
  filesystemRoots?: typeof listFilesystemRoots;
  homePath?: string;
  includeHidden?: boolean;
}>;

function toDirectoryError(error: unknown): ProjectDirectoryBrowserError {
  const code = (error as NodeJS.ErrnoException).code;
  const unavailable = code === "EACCES" || code === "EPERM";
  return new ProjectDirectoryBrowserError(
    unavailable ? "Project directory is not accessible" : "Project directory is invalid",
    unavailable ? "directory-unavailable" : "invalid-directory",
    { cause: error instanceof Error ? error : undefined },
  );
}

function compareDirectories(left: Dirent, right: Dirent): number {
  return (
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
    left.name.localeCompare(right.name, "en")
  );
}

export async function resolveProjectDirectory(
  requestedPath?: string,
  options: ProjectDirectoryBrowserOptions = {},
): Promise<string> {
  const path = requestedPath ?? options.homePath ?? homedir();
  if (!isAbsolute(path)) {
    throw new ProjectDirectoryBrowserError(
      "Project directory path must be absolute",
      "invalid-directory",
    );
  }

  try {
    const normalizedPath = await realpath(path);
    if (!(await lstat(normalizedPath)).isDirectory()) {
      throw new ProjectDirectoryBrowserError(
        "Project directory path must identify a directory",
        "invalid-directory",
      );
    }
    return normalizedPath;
  } catch (error) {
    if (error instanceof ProjectDirectoryBrowserError) {
      throw error;
    }
    throw toDirectoryError(error);
  }
}

export async function readProjectDirectory(
  requestedPath?: string,
  options: ProjectDirectoryBrowserOptions = {},
): Promise<ProjectDirectoryListing> {
  const [path, roots] = await Promise.all([
    resolveProjectDirectory(requestedPath, options),
    (options.filesystemRoots ?? listFilesystemRoots)(),
  ]);
  let entries: ProjectDirectoryListing["entries"];
  try {
    const children: Dirent[] = await readdir(path, { withFileTypes: true });
    const classifiedChildren = await classifyFilesystemEntries(
      path,
      children.filter((child) => options.includeHidden === true || !child.name.startsWith(".")),
    );
    entries = classifiedChildren
      .filter(({ type }) => type === "directory")
      .map(({ entry }) => entry)
      .sort(compareDirectories)
      .map((child) => ({ name: child.name, path: join(path, child.name) }));
  } catch (error) {
    throw toDirectoryError(error);
  }

  const parentPath = dirname(path);
  return {
    entries,
    parentPath: parentPath === path ? null : parentPath,
    path,
    roots,
  };
}
