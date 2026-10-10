import { remapSplitLayout, type SplitLayout } from "./split-layout.js";
import {
  removeSplitPane,
  selectSplitTask,
  splitPaneKey,
  type SplitPaneIdentity,
} from "./split-workspace.js";

export type SplitWorkspaceSelection = Readonly<{
  routeKey: string;
  routePaneKey: string | undefined;
  panes: readonly SplitPaneIdentity[];
  activeKey: string | undefined;
  layout: SplitLayout | undefined;
}>;

export function isSplitWorkspaceDetached(selection: SplitWorkspaceSelection): boolean {
  const first = selection.panes[0];
  // 分屏收敛后的单窗口可能已脱离原 URL，仍需接管旧路由任务的清理导航。
  return (
    first !== undefined &&
    (selection.panes.length > 1 || splitPaneKey(first) !== selection.routePaneKey)
  );
}

export function syncSplitTaskRoute(
  selection: SplitWorkspaceSelection,
  current: SplitPaneIdentity | undefined,
  routeKey: string,
  enabled: boolean,
): SplitWorkspaceSelection {
  const currentKey = current === undefined ? undefined : splitPaneKey(current);
  // 遗漏导航桥的任务路由也只替换聚焦窗口；工具页面和普通单窗口继续重建路由工作区。
  if (!enabled || selection.panes.length < 2 || current?.taskId === undefined) {
    return {
      routeKey,
      routePaneKey: currentKey,
      panes: current === undefined ? [] : [current],
      activeKey: currentKey,
      layout: undefined,
    };
  }
  const next = selectSplitTask(selection, current);
  return {
    ...next,
    routeKey,
    routePaneKey: currentKey,
    layout:
      next.panes === selection.panes
        ? selection.layout
        : remapSplitLayout(selection.layout, (key) =>
            key === selection.activeKey ? currentKey : key,
          ),
  };
}

export function dismissSplitTask(
  selection: SplitWorkspaceSelection,
  pane: SplitPaneIdentity,
  createDraft: (projectId: string) => SplitPaneIdentity,
): SplitWorkspaceSelection {
  const key = splitPaneKey(pane);
  // 删除/归档按最新任务身份处理，迟到结果不能关闭等待期间切换出来的新聊天。
  if (!selection.panes.some((item) => splitPaneKey(item) === key)) return selection;
  const panes =
    selection.panes.length === 1
      ? [createDraft(pane.projectId)]
      : removeSplitPane(selection.panes, pane);
  const first = panes[0];
  return {
    ...selection,
    panes,
    activeKey:
      selection.activeKey === key
        ? first === undefined
          ? undefined
          : splitPaneKey(first)
        : selection.activeKey,
    layout: remapSplitLayout(selection.layout, (layoutKey) =>
      panes.some((item) => splitPaneKey(item) === layoutKey) ? layoutKey : undefined,
    ),
  };
}
