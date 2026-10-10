import { memo, useContext, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { splitPaneKey, type SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";
import {
  SplitPaneContext,
  SplitWorkspaceGrid,
  SplitWorkspaceProvider,
  useNavigateSplitTask,
  useOpenSplitDraft,
  useSplitWorkspace,
  useSplitWorkspaceActions,
  useSplitWorkspaceState,
} from "@codexly/ui/core/split-workspace";
import { useSplitInspectorBridge } from "@codexly/ui/core/split-inspector";

const toggleSidebar = () => undefined;

// 使用真实 React 客户端渲染；同时执行聊天控制器和右栏桥接订阅，避免只测孤立 Context。
export function measureSplitWorkspaceFocus(desktop: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const panes: SplitPaneIdentity[] = ["one", "two", "three", "four"].map((taskId) => ({
    projectId: "project",
    taskId,
  }));
  const renders = [0, 0, 0, 0];
  const mounts = [0, 0, 0, 0];
  const subscriptionRenders = [0, 0];
  let actions: NonNullable<ReturnType<typeof useSplitWorkspaceActions>>;
  let workspace: NonNullable<ReturnType<typeof useSplitWorkspace>>;
  const ActionsProbe = memo(function ActionsProbe() {
    const value = useSplitWorkspaceActions()!;
    useLayoutEffect(() => {
      actions = value;
    }, [value]);
    subscriptionRenders[0] = subscriptionRenders[0]! + 1;
    return null;
  });
  const StateProbe = memo(function StateProbe() {
    useSplitWorkspaceState();
    subscriptionRenders[1] = subscriptionRenders[1]! + 1;
    return null;
  });
  const Probe = memo(function Probe({ index }: { index: number }) {
    const pane = useContext(SplitPaneContext)!;
    const mounted = useRef(false);
    if (!mounted.current) {
      mounted.current = true;
      mounts[index] = (mounts[index] ?? 0) + 1;
    }
    renders[index] = (renders[index] ?? 0) + 1;
    useNavigateSplitTask();
    useOpenSplitDraft();
    const shellRef = useRef<HTMLDivElement>(null);
    useSplitInspectorBridge(shellRef, () => undefined);
    return <textarea aria-label={pane.pane.taskId} defaultValue={`draft-${index}`} />;
  });
  function View() {
    const value = useSplitWorkspace()!;
    useLayoutEffect(() => {
      workspace = value;
    }, [value]);
    return (
      <SplitWorkspaceGrid
        label="Workspace"
        sidebarOpen
        toggleSidebar={toggleSidebar}
        splitLabels={{ up: "Up", down: "Down", left: "Left", right: "Right", limit: "Limit" }}
      >
        {(pane) => (
          <Probe index={panes.findIndex((item) => splitPaneKey(item) === splitPaneKey(pane))} />
        )}
      </SplitWorkspaceGrid>
    );
  }
  try {
    flushSync(() =>
      root.render(
        <SplitWorkspaceProvider current={panes[0]} routeKey="focus" desktop={desktop}>
          <ActionsProbe />
          <StateProbe />
          <View />
        </SplitWorkspaceProvider>,
      ),
    );
    const initialActions = actions!;
    for (const pane of panes.slice(1)) flushSync(() => workspace.add(pane));
    flushSync(() => workspace.focus(panes[0]!));
    const editors = [...host.querySelectorAll("textarea")];
    editors[2]!.value = "保留未发送草稿";
    const baseline = [...renders];
    const initialStateRenders = subscriptionRenders[1]!;
    // 在两个窗口间切换十二次，另两个窗口的组件和 Hook 不应重新执行。
    for (let index = 0; index < 12; index += 1) {
      flushSync(() => workspace.focus(panes[(index + 1) % 2]!));
    }
    const focusRenders = renders.map((count, index) => count - baseline[index]!);
    const focusStateRenders = subscriptionRenders[1]! - initialStateRenders;
    const beforeRepeatFocus = [...renders];
    flushSync(() => workspace.focus(panes[0]!));
    const repeatedFocusRenders = renders.map((count, index) => count - beforeRepeatFocus[index]!);
    const beforeResize = [...renders];
    flushSync(() => workspace.resize("", 0.4));
    const resizeRenders = renders.map((count, index) => count - beforeResize[index]!);
    const result = {
      focusRenders,
      resizeRenders,
      repeatedFocusRenders,
      focusStateRenders,
      actionRenders: subscriptionRenders[0],
      stableActions: actions! === initialActions,
      mounts: [...mounts],
      sameEditors: editors.every(
        (editor, index) => editor === host.querySelectorAll("textarea")[index],
      ),
      draft: editors[2]!.value,
      activeKey: workspace!.activeKey,
    };
    // 使用首次挂载时取得的方法，验证稳定引用仍读取当前四屏集合与最新焦点。
    const selected = { projectId: "other", taskId: "selected" };
    let selectedInSplit = false;
    flushSync(() => {
      selectedInSplit = initialActions.select(selected);
    });
    const selectedLatestPane =
      selectedInSplit && workspace!.panes[0] === selected && workspace!.panes.length === 4;
    flushSync(() => initialActions.solo(panes[1]!));
    const singlePaneFallback = !initialActions.select(selected);
    return { ...result, selectedLatestPane, singlePaneFallback };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
