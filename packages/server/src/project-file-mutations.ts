import {
  isValidProjectFileCreationName,
  type CreateProjectFileRequest,
  type CreateProjectFileResponse,
} from "@codexly/protocol";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { DeleteProjectFileResponse, RenameProjectFileResponse } from "@codexly/protocol";
import { renameWithoutOverwrite } from "./rename-without-overwrite.js";

const MAX_PROJECT_FILE_DEPTH = 20;

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
    pathFromRoot.startsWith(`..${sep}`) ||
    // Windows 跨盘 relative 会返回绝对路径，而不是以 .. 开头。
    isAbsolute(pathFromRoot)
  ) {
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
  return { absolutePath, resolvedRoot, directory: stats.isDirectory() };
}

export async function renameProjectFile(
  projectRoot: string,
  path: string,
  name: string,
): Promise<Omit<RenameProjectFileResponse, "tree">> {
  // 重命名与新建共用可移植名称规则，不能因部署到 Linux 就绕过 Windows 保留名校验。
  if (!isValidProjectFileCreationName(name)) {
    throw new TypeError("Project file name is invalid");
  }
  const { absolutePath, resolvedRoot, directory } = await resolveProjectFileTarget(
    projectRoot,
    path,
  );
  const targetPath = resolve(dirname(absolutePath), name);
  assertPathInsideRoot(resolvedRoot, targetPath);
  try {
    await renameWithoutOverwrite(absolutePath, targetPath, directory);
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new TypeError("Project file rename target already exists", { cause: error });
    }
    throw error;
  }
  const separatorIndex = path.lastIndexOf("/");
  const renamedPath = separatorIndex === -1 ? name : `${path.slice(0, separatorIndex)}/${name}`;
  return { path: renamedPath };
}

export async function deleteProjectFile(
  projectRoot: string,
  path: string,
): Promise<Omit<DeleteProjectFileResponse, "tree">> {
  const { absolutePath } = await resolveProjectFileTarget(projectRoot, path);
  // 目录删除是用户明确确认后的单次磁盘 Mutation，不跟随目录内符号链接。
  await rm(absolutePath, { recursive: true });
  return { path, status: "deleted" };
}

export async function createProjectFile(
  projectRoot: string,
  input: CreateProjectFileRequest,
): Promise<Omit<CreateProjectFileResponse, "tree">> {
  if (!isValidProjectFileCreationName(input.name) || !["file", "directory"].includes(input.type)) {
    throw new TypeError("Project file name or type is invalid");
  }
  const root = await realpath(projectRoot);
  const segments = input.parentPath === null ? [] : parseProjectRelativePath(input.parentPath);
  if (segments.length >= MAX_PROJECT_FILE_DEPTH)
    throw new TypeError("Project file path is invalid");
  const parent = await realpath(resolve(root, ...segments));
  if (parent !== root) assertPathInsideRoot(root, parent);
  if (!(await lstat(parent)).isDirectory()) throw new TypeError("Project file parent is invalid");
  const destination = resolve(parent, input.name);
  try {
    // 直接独占创建，不先查询存在性；已有文件、目录或链接均不能被覆盖。
    if (input.type === "directory") await mkdir(destination);
    else await (await open(destination, "wx")).close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new TypeError("Project file target already exists", { cause: error });
    }
    throw error;
  }
  return { path: [...segments, input.name].join("/") };
}
