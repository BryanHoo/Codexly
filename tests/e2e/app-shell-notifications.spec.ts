import { expect, tasks, test } from "./fixtures/app-shell.js";

for (const width of [1280, 320]) {
  test(`通知中心收集活动、分组已读并跳转任务 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route("**/v1/tasks/activity", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              projectId: "codexly",
              taskId: "task-1",
              taskName: tasks[0]?.title,
              status: "completed",
              requiresApproval: false,
              version: 1,
            },
            {
              projectId: "codexly",
              taskId: "input-design",
              taskName: "等待审核",
              status: "waiting",
              requiresApproval: true,
              version: 2,
            },
          ],
        },
      }),
    );
    await page.goto("/p/codexly");
    if (width === 320) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    const trigger = page.getByRole("button", { name: "通知，2 未读", exact: true });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "通知", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "未读 2" })).toBeVisible();
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    const box = await panel.boundingBox();
    if (!box) throw new Error("通知面板缺少布局边界");
    expect(box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeLessThanOrEqual(360);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await panel.getByRole("button", { name: /构建 macOS 工作台.*任务已完成/ }).click();
    await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/u);
    if (width === 320) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "通知，1 未读", exact: true }).click();
    await panel.getByRole("tab", { name: "已读 1" }).click();
    // Web 和移动端在已读页都可通过标题栏完成全部已读。
    await panel.locator("header").getByRole("button", { name: "全部已读", exact: true }).click();
    await expect(panel.getByRole("button", { name: "全部已读", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "已读 2" })).toBeVisible();
    await page.reload();
    if (width === 320) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "通知，0 未读", exact: true }).click();
    await expect(panel.getByRole("tab", { name: "已读 2" })).toBeVisible();
    await panel.getByRole("tab", { name: "已读 2" }).click();
    await expect(
      panel.getByRole("button", { name: /构建 macOS 工作台.*任务已完成/ }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "全部已读", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "清空已读", exact: true })).toHaveCount(0);
  });
}
