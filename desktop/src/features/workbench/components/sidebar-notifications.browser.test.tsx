import "../../../shared/styles/globals.css";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createTaskNotificationStore } from "@codexly/frontend-core/task-notification-store";
import { SidebarFooter } from "@codexly/ui/core/sidebar-footer";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";

const labels = {
  settings: "设置", help: "帮助", version: "关于版本", update: "升级", guide: "使用文档", shortcuts: "键盘快捷键",
  notifications: "通知", unread: "未读", read: "已读", markAllRead: "全部已读", markRead: "标为已读",
  clearRead: "清空已读", empty: "暂无通知", emptyUnread: "暂无未读通知", emptyRead: "暂无已读通知",
  close: "关闭通知", loadMore: "显示更多", completed: "任务已完成", failed: "任务失败", approval: "等待审批", input: "等待输入",
};

describe("轻量通知与独立底栏入口", () => {
  it("通过紧凑的未读与已读Tab切换，点击导航并支持全部已读", async () => {
    const store = createTaskNotificationStore();
    store.recordActivities(["a", "b"].map((taskId) => ({ projectId: "p", taskId, taskName: `任务 ${taskId}`, status: "completed", requiresApproval: false })));
    const onTaskNavigate = vi.fn();
    const screen = await render(<TooltipProvider><SidebarFooter labels={labels} version="1.0.0" store={store}
      onSettings={vi.fn()} onAbout={vi.fn()} onTaskNavigate={onTaskNavigate} /></TooltipProvider>);
    await screen.getByRole("button", { name: "通知，2 未读", exact: true }).click();
    await expect.element(screen.getByRole("dialog", { name: "通知", exact: true })).toBeVisible();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(store.getSnapshot().every((item) => !item.read)).toBe(true);
    await expect.element(screen.getByRole("tab", { name: "未读 2" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("dialog", { name: "通知", exact: true }).element();
    expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(screen.getByRole("button", { name: "清空已读" }).query()).toBeNull();
    await screen.getByRole("button", { name: /任务 a.*任务已完成/ }).click();
    expect(onTaskNavigate).toHaveBeenCalledExactlyOnceWith("p", "a");
    await screen.getByRole("button", { name: "通知，1 未读", exact: true }).click();
    await screen.getByRole("tab", { name: "已读 1" }).click();
    await expect.element(screen.getByRole("button", { name: /任务 a.*任务已完成/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /任务 b.*任务已完成/ }).query()).toBeNull();
    expect(screen.getByRole("button", { name: "全部已读", exact: true }).query()).toBeNull();
    await screen.getByRole("tab", { name: "未读 1" }).click();
    await screen.getByRole("button", { name: "全部已读", exact: true }).click();
    expect(store.getSnapshot().every((item) => item.read)).toBe(true);
    await expect.element(screen.getByText("暂无未读通知", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("tab", { name: "已读 2" })).toBeVisible();
    await screen.getByRole("button", { name: "关闭通知" }).click();
    await expect.element(screen.getByRole("button", { name: "通知，0 未读", exact: true })).toHaveFocus();
  });

  it("设置、帮助、版本、更新独立点击，底栏空白无操作", async () => {
    const onSettings = vi.fn(), onAbout = vi.fn(), onUpdate = vi.fn();
    const screen = await render(<TooltipProvider><SidebarFooter labels={labels} version="1.0.0" updateAvailable
      onSettings={onSettings} onAbout={onAbout} onUpdate={onUpdate} store={createTaskNotificationStore()} /></TooltipProvider>);
    await screen.getByTestId("sidebar-footer-spacer").click();
    expect(onSettings).not.toHaveBeenCalled();
    expect(onAbout).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "设置", exact: true }).click();
    expect(onSettings).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "关于版本", exact: true }).click();
    expect(onAbout).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "升级", exact: true }).click();
    expect(onUpdate).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "帮助", exact: true }).click();
    await expect.element(screen.getByRole("link", { name: "使用文档" })).toBeVisible();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.element(screen.getByRole("button", { name: "帮助", exact: true })).toHaveFocus();
  });
});
