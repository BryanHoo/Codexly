import { lstat, realpath, rename, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { DeleteProjectFileResponse, RenameProjectFileResponse } from "@codexly/protocol";

const MAX_PROJECT_FILE_DEPTH = 20;
const validFileName = /^(?!\.\.?$)[^/\\]{1,255}$/u;

function parseProjectRelativePath(path: string): readonly string[] {
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/u.test(path) ||
    segments.length > MAX_PROJECT_FILE_DEPTH ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError("Project file path is invalid");
  }
  return segments;
}

function assertPathInsideRoot(rootPath: string, targetPath: string): void {
  const pathFromRoot = relative(rootPath, targetPath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${String.raw`/`}`)
  ) {
    throw new TypeError("Project file path is outside the project root");
  }
  // Windows 的 relative 使用反斜杠，单独覆盖跨目录逃逸。
  if (pathFromRoot.startsWith("..\\") || resolve(rootPath, pathFromRoot) !== targetPath) {
    throw new TypeError("Project file path is outside the project root");
  }
}

async function resolveProjectFileTarget(projectRoot: string, path: string) {
  const resolvedRoot = await realpath(projectRoot);
  const segments = parseProjectRelativePath(path);
  const absolutePath = resolve(resolvedRoot, ...segments);
  const resolvedParent = await realpath(dirname(absolutePath));
  assertPathInsideRoot(resolvedRoot, absolutePath);
  if (resolvedParent !== resolvedRoot) {
    assertPathInsideRoot(resolvedRoot, resolvedParent);
  }
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new TypeError("Project file target must not be a symbolic link");
  }
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new TypeError("Project file target is not a file or directory");
  }
  return { absolutePath, resolvedRoot };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function renameProjectFile(
  projectRoot: string,
  path: string,
  name: string,
): Promise<RenameProjectFileResponse> {
  if (
    !validFileName.test(name) ||
    name.includes("\0") ||
    name.includes("\r") ||
    name.includes("\n")
  ) {
    throw new TypeError("Project file name is invalid");
  }
  const { absolutePath, resolvedRoot } = await resolveProjectFileTarget(projectRoot, path);
  const targetPath = resolve(dirname(absolutePath), name);
  assertPathInsideRoot(resolvedRoot, targetPath);
  if (await pathExists(targetPath)) {
    throw new TypeError("Project file rename target already exists");
  }

  await rename(absolutePath, targetPath);
  const separatorIndex = path.lastIndexOf("/");
  const renamedPath = separatorIndex === -1 ? name : `${path.slice(0, separatorIndex)}/${name}`;
  return { path: renamedPath };
}

export async function deleteProjectFile(
  projectRoot: string,
  path: string,
): Promise<DeleteProjectFileResponse> {
  const { absolutePath } = await resolveProjectFileTarget(projectRoot, path);
  // 目录删除是用户明确确认后的单次磁盘 Mutation，不跟随目录内符号链接。
  await rm(absolutePath, { recursive: true });
  return { path, status: "deleted" };
}
