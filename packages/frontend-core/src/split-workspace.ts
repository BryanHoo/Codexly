export const MAX_SPLIT_PANES = 4;

export type SplitPaneIdentity = Readonly<
  { projectId: string } & (
    { taskId: string; draftId?: never } | { taskId?: never; draftId: string }
  )
>;

export function splitPaneKey(pane: SplitPaneIdentity): string {
  // 使用结构化身份，避免项目与任务 ID 中的分隔符产生碰撞。
  return pane.taskId === undefined
    ? JSON.stringify([pane.projectId, null, pane.draftId])
    : JSON.stringify([pane.projectId, pane.taskId]);
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

export function selectSplitTask<
  Selection extends {
    panes: readonly SplitPaneIdentity[];
    activeKey: string | undefined;
  },
>(selection: Selection, next: SplitPaneIdentity): Selection {
  const activeKey = splitPaneKey(next);
  if (selection.activeKey === activeKey) return selection;
  // 左栏选择已打开任务时只移动焦点，不能套用 Fork 的去重规则删除原窗口。
  if (selection.panes.some((pane) => splitPaneKey(pane) === activeKey)) {
    return { ...selection, activeKey };
  }
  const previous = selection.panes.find((pane) => splitPaneKey(pane) === selection.activeKey);
  if (previous === undefined) return selection;
  // 使用最新聚焦身份原位替换；相邻窗口保持对象与 React key，继续保留各自状态。
  return { ...selection, panes: replaceSplitPane(selection.panes, previous, next), activeKey };
}

// 外壳只管理全局界面，窗口按自己的身份管理任务订阅与首次面板状态。
export type SplitRuntimeOptions = Readonly<{
  workspaceOnly?: boolean;
  paneOnly?: boolean;
  paneActive?: boolean;
}>;
