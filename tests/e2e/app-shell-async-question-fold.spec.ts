import {
  taskSnapshotRoute,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

for (const width of [1280, 390]) {
  for (const paginated of [false, true]) {
    test(`folds completed async questions at ${String(width)}px (paginated: ${String(paginated)}) @cross-browser`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      let processReads = 0;
      const items = [
        { id: "user", type: "message", role: "user", text: "修复展示问题" },
        {
          id: "question",
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "问题原文",
          questions: [{ title: "请确认登录状态", options: ["已登录", "稍后处理"] }],
        },
        {
          id: "answer",
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "已完成修复",
        },
      ];
      await page.route(taskSnapshotRoute("task-1"), (route) => {
        const isProcess =
          new URL(route.request().url()).searchParams.get("cursor") === "question-process";
        if (isProcess) processReads += 1;
        return route.fulfill({
          json: {
            ...taskSnapshotResponse,
            snapshot: {
              ...taskSnapshot,
              turns: [
                {
                  ...taskSnapshot.turns[0],
                  items,
                  ...(paginated && !isProcess ? { processCursor: "question-process" } : {}),
                },
              ],
            },
          },
        });
      });
      await page.goto("/p/codexly/t/task-1");
      await expect(page.getByText("已完成修复", { exact: true })).toBeVisible();
      await expect(page.getByText("请确认登录状态", { exact: true })).toHaveCount(0);
      expect(processReads).toBe(0);
      await page.getByRole("button", { name: "展开执行过程", exact: true }).click();
      await expect(page.getByText("请确认登录状态", { exact: true })).toBeVisible();
      await expect(page.getByText("稍后处理", { exact: true })).toBeVisible();
      await expect(page.getByText("已完成修复", { exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "收起执行过程", exact: true }).click();
      await expect(page.getByText("请确认登录状态", { exact: true })).not.toBeVisible();
      await page.getByRole("button", { name: "展开执行过程", exact: true }).click();
      await expect(page.getByText("请确认登录状态", { exact: true })).toBeVisible();
      expect(processReads).toBe(paginated ? 1 : 0);
    });
  }
}
