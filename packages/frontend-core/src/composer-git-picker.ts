import type { ProjectGitWorktree } from "@codexly/protocol";
import { formatDisplayPath } from "./display-path.js";

/** 仅缩短展示路径；实际选择和请求始终使用 Git 返回的原始绝对路径。 */
export function formatComposerWorkspacePath(path: string, mainPath: string | undefined) {
  const displayPath = formatDisplayPath(path);
  const normalized = displayPath.replaceAll("\\", "/").replace(/\/$/u, "");
  const root = formatDisplayPath(mainPath)?.replaceAll("\\", "/").replace(/\/$/u, "");
  if (root !== undefined && normalized.startsWith(`${root}/`))
    return normalized.slice(root.length + 1);
  if (normalized === root) return normalized.split("/").at(-1) ?? path;
  return displayPath;
}

export function buildComposerGitPicker(
  branches: readonly string[],
  currentBranch: string | null,
  worktrees: readonly ProjectGitWorktree[],
  currentPath: string | undefined,
  query: string,
) {
  const search = query.trim().toLowerCase();
  // Git porcelain 的第一条记录是主工作树；必须在筛选、当前项置顶之前保留身份。
  const mainPath = worktrees[0]?.path;
  const owners = new Map(
    worktrees.flatMap((item) => (item.branch === null ? [] : [[item.branch, item.path] as const])),
  );
  return {
    worktrees: worktrees
      .map((item) => ({
        ...item,
        main: item.path === mainPath,
        selected: item.path === currentPath,
      }))
      .filter((item) => `${item.branch ?? ""} ${item.path}`.toLowerCase().includes(search))
      .sort((a, b) => Number(b.selected) - Number(a.selected)),
    branches: branches
      .map((name) => ({
        name,
        selected: name === currentBranch,
        occupiedPath:
          name !== currentBranch && owners.get(name) !== currentPath ? owners.get(name) : undefined,
      }))
      .filter((item) => item.name.toLowerCase().includes(search))
      .sort((a, b) => Number(b.selected) - Number(a.selected)),
  };
}
