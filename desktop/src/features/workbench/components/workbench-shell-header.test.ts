import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SplitPaneContext } from "@codexly/ui/core/split-workspace";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchShellHeader } from "./workbench-shell-header.js";

const context = {
  inspectorOpen: false,
  sidebarOpen: false,
  projectOpenCapabilitiesQuery: { isPending: false },
  projectPathOpenMutation: { isPending: false },
  t: (key: string) => key,
  title: "当前任务",
} as unknown as Parameters<typeof WorkbenchShellHeader>[0]["context"];

describe("任务标题栏的新建入口", () => {
  it.each([false, true])("在分屏状态 %s 下常显同项目的新建按钮", (multiple) => {
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null,
      createElement(SplitPaneContext, { value: {
        pane: { projectId: "current-project", taskId: "current-task" },
        active: true, multiple, sidebarOpen: false, toggleSidebar: () => undefined,
      } }, createElement(WorkbenchShellHeader, {
        context, projectId: "current-project", taskId: "current-task",
        taskWriteBlocked: false, temporary: true, utilityView: false, viewTitle: "当前任务",
      })),
    ));
    expect(markup).toContain('aria-label="sidebar.newTask"');
    expect(markup).toContain("lucide-plus");
    expect(markup.indexOf('aria-label="sidebar.newTask"')).toBeLessThan(
      markup.indexOf('aria-label="shell.expandInspector"'),
    );
  });
});
