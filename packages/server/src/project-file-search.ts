import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentFileSearchMatch } from "@code-agent/core";

const MAX_PROJECT_FILE_SEARCH_DEPTH = 20;
const MAX_PROJECT_FILE_SEARCH_RESULTS = 50;
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function validSegments(path: string): readonly string[] | undefined {
  if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/u.test(path)) return undefined;
  const segments = path.split("/");
  if (
    segments.length > MAX_PROJECT_FILE_SEARCH_DEPTH ||
    segments.some(
      (segment) =>
        segment === "" || segment === "." || segment === ".." || ignoredDirectories.has(segment),
    )
  ) {
    return undefined;
  }
  return segments;
}

async function isRegularProjectFile(
  resolvedRoot: string,
  segments: readonly string[],
): Promise<boolean> {
  let currentPath = resolvedRoot;
  try {
    for (const [index, segment] of segments.entries()) {
      currentPath = resolve(currentPath, segment);
      const stats = await lstat(currentPath);
      // 逐候选检查每层，不跟随 Codex walker 可见的符号链接。
      if (stats.isSymbolicLink()) return false;
      if (index < segments.length - 1 ? !stats.isDirectory() : !stats.isFile()) return false;
    }
    return true;
  } catch {
    // 索引完成后文件可能已删除，直接省略失效候选。
    return false;
  }
}

export async function filterProjectFileSearchMatches(
  projectRoot: string,
  page: Readonly<{ data: readonly AgentFileSearchMatch[] }>,
): Promise<Readonly<{ data: readonly AgentFileSearchMatch[] }>> {
  if (page.data.length === 0) return { data: [] };
  const resolvedRoot = await realpath(projectRoot);
  const data: AgentFileSearchMatch[] = [];
  const identities = new Set<string>();
  const checkedCandidates = await Promise.all(
    page.data.slice(0, MAX_PROJECT_FILE_SEARCH_RESULTS).map(async (candidate) => {
      if (candidate.rootPath !== projectRoot || candidate.name === ".DS_Store") return undefined;
      const segments = validSegments(candidate.path);
      if (segments?.at(-1) !== candidate.name) return undefined;
      return (await isRegularProjectFile(resolvedRoot, segments)) ? candidate : undefined;
    }),
  );

  for (const candidate of checkedCandidates) {
    if (candidate === undefined) continue;
    const identity = candidate.path;
    if (identities.has(identity)) continue;
    identities.add(identity);
    data.push(candidate);
  }

  return { data };
}
