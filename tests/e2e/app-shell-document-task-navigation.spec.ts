import { expect, test, tasks, taskSnapshot, taskSnapshotRoute } from "./fixtures/app-shell.js";

for (const width of [1440, 390]) {
  test(`任务切换回聊天保留草稿，跨项目确认后关闭标签 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let saves = 0;
    await page.route("**/v1/projects/codexly/files/text**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") {
        saves++;
        await route.fulfill({ json: { version: "c".repeat(64), revision: "a".repeat(64) } });
      } else {
        await route.fulfill({
          json: url.pathname.endsWith("/revision")
            ? { revision: "a".repeat(64) }
            : {
                path: "package.json",
                content: '{"name":"codexly"}\n',
                version: "b".repeat(64),
                revision: "a".repeat(64),
              },
        });
      }
    });
    await page.route(taskSnapshotRoute("input-design"), async (route) => {
      await route.fulfill({
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          snapshot: {
            ...tasks[1],
            contextUsage: null,
            goal: null,
            pendingRequests: [],
            settings: taskSnapshot.settings,
            status: "idle",
            turns: [],
            turnsNextCursor: null,
          },
        },
      });
    });
    await page.goto("/p/codexly/t/task-1");
    if (width < 760) await page.getByRole("button", { name: "展开上下文面板" }).click();
    await page.getByRole("treeitem", { name: "package.json", exact: true }).click();
    const workspace = page.locator("[data-document-workspace]");
    const content = workspace.locator(".cm-content");
    await content.click();
    await content.press("ControlOrMeta+End");
    await page.keyboard.type("草稿");
    if (width < 760) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("link", { name: /优化输入框交互/u }).click();
    await expect(page).toHaveURL(/\/p\/codexly\/t\/input-design$/u);
    await expect(workspace.getByRole("tab", { name: "聊天", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(workspace.getByRole("tab", { name: /package\.json/u })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(saves).toBe(0);
    // 重新进入文件仍看到原草稿，回到聊天后也须保护这个后台文件。
    await workspace.getByRole("tab", { name: /package\.json/u }).click();
    await expect(content).toContainText("草稿");
    await workspace.getByRole("tab", { name: "聊天", exact: true }).click();
    if (width < 760) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "切换项目 superwork", exact: true }).click();
    await page.getByRole("link", { name: /优化计划预检反馈/u }).click();
    const dialog = page.getByRole("dialog", { name: "切换项目前保存更改？" });
    await expect(dialog).toContainText("关闭当前文件标签");
    await expect(dialog).toContainText("package.json");
    await dialog.getByRole("button", { name: "取消", exact: true }).last().click();
    await expect(page).toHaveURL(/\/p\/codexly\/t\/input-design$/u);
    if (width < 760) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("link", { name: /优化计划预检反馈/u }).click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/superwork\/t\/plan-check$/u);
    await expect(page.locator("[data-document-workspace] [role=tablist]")).toHaveCount(0);
    expect(saves).toBe(1);
  });
}
