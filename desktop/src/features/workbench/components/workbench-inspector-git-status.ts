import { filterVisibleProjectFiles, isVisibleProjectPath } from "@codexly/frontend-core/project-file-visibility";
import type { ProjectGitStatus } from "@/protocol/index.js";

import { getFileChangeStats, type AgentFileChange } from "../../diff/file-change.js";

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
      ...(existing.statsAvailable && change.statsAvailable ? { statsAvailable: true } : {}),
      stats: {
        additions: existing.stats.additions + change.stats.additions,
        removals: existing.stats.removals + change.stats.removals,
      },
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
  const allChanges = filterVisibleProjectFiles([...(gitStatus?.unstaged ?? []), ...(gitStatus?.staged ?? [])]);
  // 详情必须属于当前轻量快照，避免刷新竞态把旧行数展示到新文件集合上。
  const statsStatus = gitStatusDetails?.snapshot === gitStatus?.snapshot ? gitStatusDetails ?? gitStatus : gitStatus;
  const statsChanges =
    gitStatusDetails !== undefined && gitStatusDetails.snapshot === gitStatus?.snapshot
      ? filterVisibleProjectFiles([...gitStatusDetails.unstaged, ...gitStatusDetails.staged])
      : gitStatus?.stats !== undefined || allChanges.every((change) => change.diff !== "")
        ? allChanges
        : undefined;
  // 分页总统计仍由服务端负责；完整列表存在隐藏项时减去它们的统计。
  const hiddenStats = [...(statsStatus?.unstaged ?? []), ...(statsStatus?.staged ?? [])]
    .filter(change => !isVisibleProjectPath(change.path))
    .reduce((total, change) => ({additions: total.additions + change.stats.additions, removals: total.removals + change.stats.removals}), {additions: 0, removals: 0});
  const changeStats = statsStatus?.stats !== undefined ? {
    additions: Math.max(0, statsStatus.stats.additions - hiddenStats.additions),
    removals: Math.max(0, statsStatus.stats.removals - hiddenStats.removals),
  } : statsChanges?.reduce(
    (total, change) => {
      const stats = getFileChangeStats(change);
      return {
        additions: total.additions + stats.additions,
        removals: total.removals + stats.removals,
      };
    },
    { additions: 0, removals: 0 },
  );
  // 统计已就绪不代表正文已加载，分别标记，防止文件树和审核入口依赖正文。
  const displayChanges = mergeDisplayChanges((statsChanges ?? allChanges).map((change) =>
    statsStatus?.stats !== undefined && change.diff === "" ? { ...change, statsAvailable: true } : change,
  ));
  const fileChangesByPath = new Map(
    displayChanges.map((change) => [change.path, change] as const),
  );

  return {
    changeStats,
    displayChanges,
    fileChangesByPath,
  };
}
