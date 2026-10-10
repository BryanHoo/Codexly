import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { splitPaneKey, type SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";
import { requestSplitTaskNavigation } from "@codexly/frontend-core/split-task-navigation";
import { restoreSplitPaneFocus } from "@codexly/ui/core/split-pane-focus";
import {
  SplitWorkspaceGrid,
  SplitWorkspaceProvider,
  useSplitWorkspace,
} from "@codexly/ui/core/split-workspace";

// 通过真实客户端渲染验证两端共用工作区；不连接后端，也不改动用户任务。
export function measureSplitWorkspaceNavigation(desktop: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const panes = ["one", "two", "three", "four"].map((taskId) => ({ projectId: "project", taskId }));
  let workspace: NonNullable<ReturnType<typeof useSplitWorkspace>>;
  function View() {
    const value = useSplitWorkspace()!;
    useLayoutEffect(() => {
      workspace = value;
    }, [value]);
    return (
      <SplitWorkspaceGrid
        label="测试工作区"
        sidebarOpen
        toggleSidebar={() => undefined}
        splitLabels={{ up: "上", down: "下", left: "左", right: "右", limit: "上限" }}
      >
        {(pane) => <textarea aria-label={splitPaneKey(pane)} />}
      </SplitWorkspaceGrid>
    );
  }
  const render = (current: SplitPaneIdentity, routeKey: string) =>
    flushSync(() =>
      root.render(
        <SplitWorkspaceProvider current={current} routeKey={routeKey} desktop={desktop}>
          <View />
        </SplitWorkspaceProvider>,
      ),
    );
  try {
    render(panes[0]!, "original");
    for (const pane of panes.slice(1)) flushSync(() => workspace!.add(pane));
    flushSync(() => workspace!.focus(panes[1]!));
    flushSync(() => workspace!.resize("", 0.35));
    const editors = [...host.querySelectorAll("textarea")];
    editors[2]!.value = "保留相邻窗口草稿";
    const target = { projectId: "temporary", taskId: "search-result" };
    // 模拟尚未接入导航桥的任务入口直接更新路由。
    render(target, "task-route");
    const route = {
      count: workspace!.panes.length,
      activeKey: workspace!.activeKey,
      sameNeighbor: host.querySelectorAll("textarea")[2] === editors[2],
      draft: editors[2]!.value,
    };
    if (route.count !== 4) throw new Error(`任务路由清空分屏：期望 4 个窗口，实际 ${route.count}`);
    let handled = false;
    flushSync(() => { editors[2]!.focus(); });
    flushSync(() => {
      handled = requestSplitTaskNavigation(panes[3]!);
    });
    flushSync(() => { restoreSplitPaneFocus(editors[2]!); });
    const duplicate = { handled, count: workspace!.panes.length, activeKey: workspace!.activeKey,
      restoredToActive: document.activeElement?.getAttribute("data-split-pane") === workspace!.activeKey,
    };
    // 删除最初 URL 的任务及当前活动任务，分别验证非活动、活动窗口收敛。
    let removed = false;
    flushSync(() => {
      removed = workspace!.dismiss(panes[0]!);
    });
    const inactiveRemoval = {
      removed,
      count: workspace!.panes.length,
      activeKey: workspace!.activeKey,
    };
    flushSync(() => workspace!.dismiss(panes[3]!));
    const activeRemoval = { count: workspace!.panes.length, activeKey: workspace!.activeKey };
    const remainingEditor = host.querySelectorAll("textarea")[1];
    flushSync(() => workspace!.dismiss(target));
    const single = {
      count: workspace!.panes.length,
      sameEditor: host.querySelector("textarea") === remainingEditor,
    };
    // 分屏收敛为单窗后 URL 仍可能指向已关闭任务，删除最后任务要显示空草稿。
    flushSync(() => workspace!.dismiss(panes[2]!));
    const empty = { count: workspace!.panes.length, draftId: workspace!.panes[0]?.draftId };
    render(panes[0]!, "single-route");
    return {
      route,
      duplicate,
      inactiveRemoval,
      activeRemoval,
      single,
      empty,
      singleRouteCount: workspace!.panes.length,
    };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
