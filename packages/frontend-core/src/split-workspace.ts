export const MAX_SPLIT_PANES = 4;

export type SplitPaneIdentity = Readonly<{ projectId: string; taskId: string }>;

export function splitPaneKey(pane: SplitPaneIdentity): string {
  // 使用结构化身份，避免项目与任务 ID 中的分隔符产生碰撞。
  return JSON.stringify([pane.projectId, pane.taskId]);
}

export function addSplitPane(
  panes: readonly SplitPaneIdentity[],
  pane: SplitPaneIdentity,
): readonly SplitPaneIdentity[] {
  const key = splitPaneKey(pane);
  if (panes.length >= MAX_SPLIT_PANES || panes.some((item) => splitPaneKey(item) === key)) {
    return panes;
  }
  return [...panes, pane];
}

export function removeSplitPane(
  panes: readonly SplitPaneIdentity[],
  pane: SplitPaneIdentity,
): readonly SplitPaneIdentity[] {
  // 最后一个窗口继续承担普通聊天，关闭分屏不会关闭任务本身。
  if (panes.length <= 1) return panes;
  return panes.filter((item) => splitPaneKey(item) !== splitPaneKey(pane));
}

export function replaceSplitPane(
  panes: readonly SplitPaneIdentity[],
  previous: SplitPaneIdentity,
  next: SplitPaneIdentity,
): readonly SplitPaneIdentity[] {
  if (splitPaneKey(previous) === splitPaneKey(next)) return panes;
  if (!panes.some((pane) => splitPaneKey(pane) === splitPaneKey(previous))) return panes;
  const alreadyOpen = panes.some((pane) => splitPaneKey(pane) === splitPaneKey(next));
  return panes.flatMap((pane) =>
    splitPaneKey(pane) !== splitPaneKey(previous) ? [pane] : alreadyOpen ? [] : [next],
  );
}

// 外壳只管理全局界面，窗口按自己的身份管理任务订阅与首次面板状态。
export type SplitRuntimeOptions = Readonly<{
  workspaceOnly?: boolean;
  paneOnly?: boolean;
  paneActive?: boolean;
  compactPane?: boolean;
}>;
