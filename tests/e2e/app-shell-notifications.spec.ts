import { expect, tasks, test } from "./fixtures/app-shell.js";

for (const width of [1280, 320]) {
  test(`活动快照展示任务完成和待审批状态并可跳转 ${String(width)}px @cross-browser`, async ({
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
    const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
    const completed = sidebar.locator('a[href="/p/codexly/t/task-1"]').first();
    await expect(completed.getByRole("status")).toHaveAccessibleName("AI 回复已完成");
    await completed.click();
    await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/u);
    await page.reload();
    if (width === 320) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    const pending = sidebar.locator('a[href="/p/codexly/t/input-design"]').first();
    await expect(pending.getByRole("status")).toBeVisible();
    await expect(pending.getByRole("status")).toHaveAccessibleName(/审批|批准/u);
    await pending.click();
    await expect(page).toHaveURL(/\/p\/codexly\/t\/input-design$/u);
  });
}
