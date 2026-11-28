import type { ReactNode } from "react";
import { SidebarFooter } from "@codexly/ui/core/sidebar-footer";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as desktopLanguage } from "../../src/i18n/i18n.js";
import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { SidebarScheduledTasksLink as WebScheduled } from "../../../apps/web/src/features/workbench/components/sidebar-scheduled-tasks-link.js";
import { SidebarScheduledTasksLink as DesktopScheduled } from "../../src/features/workbench/components/sidebar-scheduled-tasks-link.js";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import "../../src/shared/styles/globals.css";

// 使用真实共享底栏，让定时任务入口拥有与应用一致的生命周期。
function Footer({ children }: Readonly<{ children: ReactNode }>) {
  return <SidebarFooter labels={{ settings: "设置", help: "帮助", version: "版本", update: "升级", guide: "文档", shortcuts: "快捷键" }} version="1.0.0" onSettings={() => undefined} onAbout={() => undefined}>{children}</SidebarFooter>;
}

beforeEach(async () => { await webLanguage("zh-CN"); await desktopLanguage("zh-CN"); });

for (const [platform, Scheduled] of [["Web", WebScheduled], ["桌面", DesktopScheduled]] as const) {
  it.each([[undefined, 360], [undefined, 1280], ["project-1", 360], ["project-1", 1280]] as const)(`${platform} 重复点击返回原页面，并处理浏览器历史（项目：%s，宽度：%s）`, async (projectId, width) => {
    await page.viewport(width, 800);
    const base = projectId ? `/p/${projectId}` : "/temporary";
    const origin = `${base}/t/task-1?view=detail#message-2`;
    const root = createRootRoute({ component: () => <TooltipProvider><Footer>
      <Scheduled {...(projectId ? { projectId } : {})} />
    </Footer></TooltipProvider> });
    const route = createRoute({ getParentRoute: () => root, path: "$" });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [origin] }) });
    await router.load();
    const screen = await render(<RouterProvider router={router} />);
    const scheduled = screen.getByRole("link", { name: "定时任务", exact: true });
    try {
      await scheduled.click();
      await expect.poll(() => router.state.location.pathname).toBe(`${base}/scheduled`);
      await expect.element(scheduled).toHaveAttribute("data-status", "active");
      await scheduled.click();
      await expect.poll(() => router.state.location.href).toBe(origin);
      await expect.element(scheduled).not.toHaveAttribute("data-status", "active");
      router.history.back();
      await expect.poll(() => router.state.location.pathname).toBe(`${base}/scheduled`);
      await scheduled.click();
      await expect.poll(() => router.state.location.href).toBe(origin);
      // 回到另一任务再进入时，来源更新为新任务，不能复用上一次来源。
      const nextTask = `${base}/t/task-2?view=other#message-3`;
      await router.navigate({ href: nextTask });
      await scheduled.click();
      await scheduled.click();
      await expect.poll(() => router.state.location.href).toBe(nextTask);
    } finally { await screen.unmount(); }
  });
  it(`${platform} 直接打开定时任务时取消选中返回当前工作台`, async () => {
    const root = createRootRoute({ component: () => <TooltipProvider><Footer>
      <Scheduled projectId="project-1" />
    </Footer></TooltipProvider> });
    const route = createRoute({ getParentRoute: () => root, path: "$" });
    const initial = "/p/project-1/scheduled";
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [initial] }) });
    await router.load();
    const screen = await render(<RouterProvider router={router} />);
    try {
      await screen.getByRole("link", { name: "定时任务", exact: true }).click();
      await expect.poll(() => router.state.location.pathname).toBe("/p/project-1");
    } finally { await screen.unmount(); }
  });

}
