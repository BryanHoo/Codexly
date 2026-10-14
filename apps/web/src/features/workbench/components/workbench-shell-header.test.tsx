import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SplitPaneContext, SplitWorkspaceProvider } from "@codexly/ui/core/split-workspace";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchShellHeader } from "./workbench-shell-header.js";

const context = {
  inspectorOpen: false,
  sidebarOpen: false,
  projectOpenCapabilitiesQuery: { isPending: true },
  projectPathOpenMutation: { isPending: false },
  t: (key: string) => key,
  title: "当前任务",
} as unknown as Parameters<typeof WorkbenchShellHeader>[0]["context"];

describe("任务标题栏的新建入口", () => {
  it.each([false, true])("分屏状态 %s 下只在单窗口显示布局入口，并放在快捷打开之前", (multiple) => {
    const current = { projectId: "current-project", taskId: "current-task" };
    const markup = renderToStaticMarkup(
      <SplitWorkspaceProvider current={current} routeKey="current" desktop>
        <TooltipProvider>
          <SplitPaneContext
            value={{
              pane: current,
              active: true,
              multiple,
              sidebarOpen: false,
              toggleSidebar: () => undefined,
            }}
          >
            <WorkbenchShellHeader
              board={false}
              context={context}
              projectId={current.projectId}
              scheduled={false}
              skillsMarket={false}
              temporary={false}
            />
          </SplitPaneContext>
        </TooltipProvider>
      </SplitWorkspaceProvider>,
    );
    if (multiple) expect(markup).not.toContain('aria-label="split.chooseLayout"');
    else {
      expect(markup).toContain('aria-label="split.chooseLayout"');
      expect(markup.indexOf('aria-label="sidebar.newTask"')).toBeLessThan(
        markup.indexOf('aria-label="split.chooseLayout"'),
      );
      const quickOpen = markup.indexOf('data-slot="button-group"');
      expect(quickOpen).toBeGreaterThan(0);
      expect(markup.indexOf('aria-label="split.chooseLayout"')).toBeLessThan(quickOpen);
    }
  });

  it.each([false, true])("在分屏状态 %s 下常显同项目的新建按钮", (multiple) => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <SplitPaneContext
          value={{
            pane: { projectId: "current-project", taskId: "current-task" },
            active: true,
            multiple,
            sidebarOpen: false,
            toggleSidebar: () => undefined,
          }}
        >
          <WorkbenchShellHeader
            board={false}
            context={context}
            projectId="current-project"
            scheduled={false}
            skillsMarket={false}
            taskId="current-task"
            temporary
          />
        </SplitPaneContext>
      </TooltipProvider>,
    );
    expect(markup).toContain('aria-label="sidebar.newTask"');
    expect(markup).toContain("lucide-plus");
    expect(markup.indexOf('aria-label="sidebar.newTask"')).toBeLessThan(
      markup.indexOf('aria-label="shell.expandInspector"'),
    );
  });
});
