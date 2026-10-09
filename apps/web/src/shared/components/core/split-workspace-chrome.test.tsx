import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarTaskAnchor } from "@codexly/ui/core/sidebar-task-anchor";
import { SplitInspectorProvider } from "@codexly/ui/core/split-inspector";
import { useWorkbenchPanelLayout } from "../../../features/workbench/components/workbench-panel-layout.js";

describe("分屏外层面板", () => {
  function PanePanel({ initiallyOpen }: { initiallyOpen: boolean }) {
    const { inspectorOpen } = useWorkbenchPanelLayout({ inspectorInitiallyOpen: initiallyOpen });
    return <span>{inspectorOpen ? "已展开" : "已收起"}</span>;
  }

  it.each([true, false])("各窗口服从统一的右栏开关：%s", (open) => {
    const markup = renderToStaticMarkup(
      <SplitInspectorProvider open={open} setOpen={() => undefined}>
        <PanePanel initiallyOpen />
        <PanePanel initiallyOpen={false} />
      </SplitInspectorProvider>,
    );
    expect(markup).toBe(
      open ? "<span>已展开</span><span>已展开</span>" : "<span>已收起</span><span>已收起</span>",
    );
  });

  it("普通工作台没有分屏上下文时保留自己的面板状态", () => {
    expect(renderToStaticMarkup(<PanePanel initiallyOpen />)).toBe("<span>已展开</span>");
    expect(renderToStaticMarkup(<PanePanel initiallyOpen={false} />)).toBe("<span>已收起</span>");
  });

  it("路由停留在原任务时只把聚焦任务标记为当前任务", () => {
    const markup = renderToStaticMarkup(
      <>
        <SidebarTaskAnchor
          href="/original"
          taskActive={false}
          aria-current="page"
          data-status="active"
        >
          原任务
        </SidebarTaskAnchor>
        <SidebarTaskAnchor href="/focused" taskActive>
          聚焦任务
        </SidebarTaskAnchor>
      </>,
    );
    expect(markup).toBe(
      '<a href="/original">原任务</a><a href="/focused" aria-current="page" data-status="active">聚焦任务</a>',
    );
  });
});
