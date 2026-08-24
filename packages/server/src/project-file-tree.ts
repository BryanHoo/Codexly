import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectFileTree, ProjectFileTreeEntry } from "@code-agent/protocol";

import {
  classifyFilesystemEntries,
  type ClassifiedFilesystemEntry,
} from "./filesystem-entry-type.js";

export const MAX_PROJECT_FILE_TREE_DEPTH = 20;

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
// Finder 元数据不属于项目内容，目录树与文件搜索统一跳过。
const ignoredFiles = new Set([".DS_Store"]);

function compareEntries(left: ClassifiedFilesystemEntry, right: ClassifiedFilesystemEntry): number {
  const typeOrder = Number(right.type === "directory") - Number(left.type === "directory");
  if (typeOrder !== 0) {
    return typeOrder;
  }
  return left.entry.name.localeCompare(right.entry.name, "en");
}

async function readClassifiedDirectory(path: string): Promise<ClassifiedFilesystemEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return classifyFilesystemEntries(path, entries);
}

function joinProjectPath(parentPath: string, name: string): string {
  return parentPath.length === 0 ? name : `${parentPath}/${name}`;
}

function parseDirectorySegments(directoryPath: string | undefined): readonly string[] {
  if (directoryPath === undefined) {
    return [];
  }
  if (
    directoryPath.startsWith("/") ||
    directoryPath.endsWith("/") ||
    directoryPath.includes("\\") ||
    directoryPath.includes("//") ||
    /^[A-Za-z]:/u.test(directoryPath)
  ) {
    throw new TypeError("Project file tree path must be project-relative");
  }
  const segments = directoryPath.split("/");
  if (
    segments.length > MAX_PROJECT_FILE_TREE_DEPTH ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError("Project file tree path is invalid");
  }
  return segments;
}

async function resolveDirectoryContext(projectRoot: string, directoryPath: string | undefined) {
  const resolvedProjectRoot = await realpath(projectRoot);
  const segments = parseDirectorySegments(directoryPath);
  let absoluteDirectory = resolvedProjectRoot;
  let relativeDirectory = "";

  for (const segment of segments) {
    const nextRelativeDirectory = joinProjectPath(relativeDirectory, segment);
    if (ignoredDirectories.has(segment)) {
      throw new TypeError("Project file tree directory is not available");
    }
    const nextAbsoluteDirectory = resolve(absoluteDirectory, segment);
    const stats = await lstat(nextAbsoluteDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new TypeError("Project file tree path must identify a directory");
    }
    absoluteDirectory = nextAbsoluteDirectory;
    relativeDirectory = nextRelativeDirectory;
  }

  return { absoluteDirectory, relativeDirectory };
}

export async function readProjectFileTree(
  projectRoot: string,
  directoryPath?: string,
): Promise<ProjectFileTree> {
  const { absoluteDirectory, relativeDirectory } = await resolveDirectoryContext(
    projectRoot,
    directoryPath,
  );
  const children = (await readClassifiedDirectory(absoluteDirectory)).sort(compareEntries);
  const entries: ProjectFileTreeEntry[] = [];

  for (const { entry: child, type } of children) {
    // 符号链接不进入树，避免跟随链接越过 Project 根目录或形成递归环。
    if (child.name === ".git" || ignoredFiles.has(child.name) || type === "symbolic-link") {
      continue;
    }
    if (type === "directory" && ignoredDirectories.has(child.name)) {
      continue;
    }
    if (type !== "directory" && type !== "file") {
      continue;
    }
    const path = joinProjectPath(relativeDirectory, child.name);
    entries.push({ path, type });
  }

  return { entries, path: directoryPath ?? null };
}
