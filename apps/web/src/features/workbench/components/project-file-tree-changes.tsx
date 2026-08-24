import { i18n } from "../../../i18n/i18n.js";
import { countFileChangeLines, type AgentFileChange } from "../../diff/file-change.js";
import type { ProjectFileTreeItem } from "./project-file-tree-model.js";

const PROJECT_FILE_TREE_OVERSCAN = 8;

export type ProjectFileTreeChangeStats = Readonly<{
  additions: number;
  removals: number;
}>;

export function getProjectFileTreeMaximumMountedRows(
  itemCount: number,
  viewportHeight: number,
): number {
  const visibleRows = Math.ceil(viewportHeight / 28);
  return Math.min(itemCount, visibleRows + PROJECT_FILE_TREE_OVERSCAN * 2);
}

export function pruneCollapsedProjectFileTreePaths(
  previousPaths: ReadonlySet<string>,
  nextPaths: ReadonlySet<string>,
): Set<string> {
  const collapsedPaths = [...previousPaths].filter((path) => !nextPaths.has(path));
  return new Set(
    [...nextPaths].filter(
      (path) => !collapsedPaths.some((collapsedPath) => path.startsWith(`${collapsedPath}/`)),
    ),
  );
}

export function collectVisibleProjectFileTreeChangeStats(
  changesByPath: ReadonlyMap<string, AgentFileChange>,
  visibleItems: readonly ProjectFileTreeItem[],
): ReadonlyMap<string, ProjectFileTreeChangeStats> {
  const visibleEntries = visibleItems.filter((item) => item.kind === "entry");
  const statsByPath = new Map<string, ProjectFileTreeChangeStats>();

  for (const change of changesByPath.values()) {
    const path = change.path.replaceAll("\\", "/");
    let target: (typeof visibleEntries)[number] | undefined;
    for (const entry of visibleEntries) {
      const containsChange =
        entry.path === path || (entry.type === "directory" && path.startsWith(`${entry.path}/`));
      if (containsChange && (target === undefined || entry.path.length > target.path.length)) {
        target = entry;
      }
    }
    if (target === undefined) continue;

    const current = statsByPath.get(target.path);
    const stats = countFileChangeLines(change);
    statsByPath.set(target.path, {
      additions: (current?.additions ?? 0) + stats.additions,
      removals: (current?.removals ?? 0) + stats.removals,
    });
  }

  return statsByPath;
}

export function ProjectFileTreeChangeIndicator({
  path,
  stats,
}: Readonly<{ path: string; stats: ProjectFileTreeChangeStats }>) {
  return (
    <span
      aria-label={i18n.t("inspector.changeIndicator", {
        additions: stats.additions,
        ns: "conversation",
        path,
        removals: stats.removals,
      })}
      className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-meta group-hover/file-tree-node:invisible group-focus-within/file-tree-node:invisible"
    >
      <span className="font-medium text-diff-added">+{stats.additions}</span>
      <span className="font-medium text-diff-removed">-{stats.removals}</span>
    </span>
  );
}
