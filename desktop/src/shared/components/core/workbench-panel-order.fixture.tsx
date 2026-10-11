import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal, flushSync } from "react-dom";
import { SplitInspectorProvider, useSplitInspector, useSplitInspectorBridge } from "@codexly/ui/core/split-inspector";
import { SplitPaneContext } from "@codexly/ui/core/split-workspace";
import sharedStyles from "@codexly/ui/core/split-workspace.css?raw";
import webStyles from "../../../../../apps/web/src/shared/styles/workbench.css?raw";
import desktopStyles from "../../styles/workbench.css?raw";

const ignore = () => undefined;
const pane = { projectId: "panel-order", taskId: "task" };

function TaskPane() {
  const inspector = useSplitInspector();
  return (
    <div className="workbench-shell" data-embedded="true" style={{ height: "100%" }}>
      <main><textarea aria-label="任务草稿" /></main>
      {inspector?.target == null ? null : createPortal(
        <aside className="workbench-inspector">任务右栏</aside>, inspector.target,
      )}
    </div>
  );
}

function Shell({ utility, sidebarOpen }: { utility: boolean; sidebarOpen: boolean }) {
  const shellRef = useRef<HTMLDivElement>(null);
  useSplitInspectorBridge(shellRef, ignore);
  return (
    <div ref={shellRef} className="workbench-shell" data-embedded="false"
      data-sidebar-open={sidebarOpen} data-inspector-open={!utility} style={{ height: "500px" }}>
      <aside className="workbench-sidebar">项目侧栏</aside>
      {utility ? <main>扩展中心</main> : (
        <div className="split-workspace">
          <SplitPaneContext value={{ pane, active: true, multiple: false, toggleSidebar: ignore, sidebarOpen }}>
            <TaskPane />
          </SplitPaneContext>
        </div>
      )}
    </div>
  );
}

// 使用真实 Portal 与两端生产样式复现挂载顺序；独立宿主不读取或修改用户任务。
export function measureWorkbenchPanelOrder(desktop: boolean, sidebarOpen = true) {
  const host = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = sharedStyles + (desktop ? desktopStyles : webStyles).replace(/^@import .*;$/gmu, "") +
    ".workbench-shell { --sidebar-open-width: 240px; --inspector-open-width: 320px; --ui-layout-inspector-width: 320px; --ui-layout-sidebar-width: 240px; transition: none; }";
  document.head.append(style);
  document.body.append(host);
  const root = createRoot(host);
  const render = (utility: boolean) => flushSync(() => root.render(
    <SplitInspectorProvider open setOpen={ignore}><Shell utility={utility} sidebarOpen={sidebarOpen} /></SplitInspectorProvider>,
  ));
  const measure = () => {
    const shell = host.querySelector<HTMLElement>(".workbench-shell")!;
    const center = shell.querySelector<HTMLElement>(":scope > .split-workspace")!;
    const inspector = shell.querySelector<HTMLElement>(":scope > .workbench-inspector")!;
    const inner = center.querySelector<HTMLElement>("main")!;
    const bounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return { shell: bounds(shell), center: bounds(center), inspector: bounds(inspector), inner: bounds(inner) };
  };
  try {
    render(false);
    const before = measure();
    // 连续切换验证每次恢复均稳定，不能只修复第一次挂载。
    const restored = Array.from({ length: 3 }, () => {
      render(true);
      render(false);
      return measure();
    });
    return { before, restored };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    style.remove();
  }
}
