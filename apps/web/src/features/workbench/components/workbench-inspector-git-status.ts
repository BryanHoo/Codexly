import type { ProjectGitStatus } from "@codexly/protocol";

import { countFileChangeLines, type AgentFileChange } from "../../diff/file-change.js";

export type InspectorGitChangeState = Readonly<{
  changeStats: Readonly<{ additions: number; removals: number }> | undefined;
  displayChanges: readonly AgentFileChange[];
  fileChangesByPath: ReadonlyMap<string, AgentFileChange>;
}>;

function mergeDisplayChanges(changes: readonly AgentFileChange[]): readonly AgentFileChange[] {
  const mergedChanges = new Map<string, AgentFileChange>();
  for (const change of changes) {
    const existing = mergedChanges.get(change.path);
    if (existing === undefined) {
      mergedChanges.set(change.path, change);
      continue;
    }
    // staged 与 unstaged 可能同时包含同一路径，合并后只计为一个变更文件。
    mergedChanges.set(change.path, {
      diff: [existing.diff, change.diff].filter((value) => value !== "").join("\n"),
      kind: existing.kind === change.kind ? existing.kind : "update",
      path: change.path,
    });
  }
  return [...mergedChanges.values()];
}

export function deriveInspectorGitChangeState(
  gitStatus: ProjectGitStatus | undefined,
  gitStatusDetails: ProjectGitStatus | undefined,
): InspectorGitChangeState {
  const allChanges = [...(gitStatus?.unstaged ?? []), ...(gitStatus?.staged ?? [])];
  // 详情必须属于当前轻量快照，避免刷新竞态把旧行数展示到新文件集合上。
  const statsChanges =
    gitStatusDetails !== undefined && gitStatusDetails.snapshot === gitStatus?.snapshot
      ? [...gitStatusDetails.unstaged, ...gitStatusDetails.staged]
      : allChanges.every((change) => change.diff !== "")
        ? allChanges
        : undefined;
  const changeStats = statsChanges?.reduce(
    (total, change) => {
      const stats = countFileChangeLines(change);
      return {
        additions: total.additions + stats.additions,
        removals: total.removals + stats.removals,
      };
    },
    { additions: 0, removals: 0 },
  );
  const displayChanges = mergeDisplayChanges(statsChanges ?? allChanges);
  const fileChangesByPath = new Map(displayChanges.map((change) => [change.path, change] as const));

  return {
    changeStats,
    displayChanges,
    fileChangesByPath,
  };
}
