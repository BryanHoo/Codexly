import { expect, taskSnapshot, taskSnapshotRoute, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  for (const embedded of [false, true]) {
    test(`子代理展示任务、状态与${embedded ? "嵌套执行记录" : "独立线程结果"} ${String(width)}px @cross-browser`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.route(taskSnapshotRoute("task-1"), async (route) => {
        await route.fulfill({
          json: {
            checkpoint: { sequence: 0, sessionId: "subagent-session" },
            snapshot: {
              ...taskSnapshot,
              status: "running",
              turns: [
                {
                  id: "parent-turn",
                  status: "running",
                  startedAt: new Date().toISOString(),
                  completedAt: null,
                  error: null,
                  items: [
                    { id: "user", type: "message", role: "user", text: "请研究缓存失效原因" },
                    {
                      id: "spawn",
                      type: "tool",
                      name: "agent/spawn",
                      status: "running",
                      input: {
                        prompt: "检查构建缓存键",
                        model: "test-model",
                        reasoningEffort: "high",
                      },
                      output: {
                        agents: [
                          {
                            taskId: "child-1",
                            nickname: "缓存研究员",
                            status: "running",
                            message: "正在检查缓存",
                          },
                        ],
                        ...(embedded
                          ? {
                              parentTaskId: "task-1",
                              turn: {
                                id: "child-turn",
                                status: "running",
                                startedAt: new Date().toISOString(),
                                completedAt: null,
                                error: null,
                                items: [
                                  {
                                    id: "child-turn:rendering-omitted",
                                    type: "activity",
                                    label: "已省略较早执行记录",
                                    status: "completed",
                                  },
                                  {
                                    id: "child-turn",
                                    type: "message",
                                    role: "user",
                                    text: "检查构建缓存键",
                                  },
                                  {
                                    id: "read",
                                    type: "tool",
                                    name: "read_file",
                                    status: "completed",
                                    input: { path: "scripts/cache.ts" },
                                    output: "cacheKey = commitSHA",
                                  },
                                  {
                                    id: "report",
                                    type: "message",
                                    role: "assistant",
                                    text: "缓存键使用了提交标识。",
                                  },
                                ],
                              },
                            }
                          : {}),
                      },
                    },
                  ],
                },
              ],
            },
          },
        });
      });
      let childReads = 0;
      await page.route(taskSnapshotRoute("child-1"), async (route) => {
        childReads += 1;
        await route.fulfill({
          json: {
            checkpoint: { sequence: 0, sessionId: "e2e-session" },
            snapshot: {
              ...taskSnapshot,
              id: "child-1",
              title: "缓存研究员",
              status: "running",
              turns: [
                {
                  id: "child-turn",
                  status: "running",
                  startedAt: new Date().toISOString(),
                  completedAt: null,
                  error: null,
                  items: [
                    { id: "child-user", type: "message", role: "user", text: "检查构建缓存键" },
                    {
                      id: "child-read",
                      type: "tool",
                      name: "read_file",
                      status: "completed",
                      input: { path: "scripts/cache.ts" },
                      output: "cacheKey = commitSHA",
                    },
                    {
                      id: "child-report",
                      type: "message",
                      role: "assistant",
                      text: "缓存键使用了提交标识。",
                    },
                  ],
                },
              ],
            },
          },
        });
      });
      await page.goto("/p/codexly/t/task-1");
      const trigger = page.locator("[data-subagent]").getByRole("button");
      await expect(trigger).toBeVisible();
      await expect(page.locator("[data-subagent-details]")).toHaveCount(0);
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("检查构建缓存键", { exact: true })).toHaveCount(1);
      await expect(dialog.getByText("检查构建缓存键", { exact: true })).toBeVisible();
      await expect(dialog.getByText("test-model", { exact: true })).toBeVisible();
      await expect(dialog.getByText("high", { exact: true })).toBeVisible();
      await expect(dialog.getByText("缓存研究员", { exact: true })).toBeVisible();
      await expect(dialog.getByText("正在检查缓存", { exact: true })).toBeVisible();
      await expect(
        dialog.locator("[data-subagent-task] [data-slot=trace-status-icon]"),
      ).toHaveAttribute("data-status", "running");
      if (embedded) {
        const step = dialog.getByRole("button", { name: /read_file/ });
        await expect(step).toBeVisible();
        await expect(dialog.getByText("缓存键使用了提交标识。", { exact: true })).toBeVisible();
        await step.click();
        await expect(dialog.getByText("cacheKey = commitSHA", { exact: true })).toBeVisible();
      }
      expect(
        await dialog.evaluate(
          (element) => element.getBoundingClientRect().height <= window.innerHeight * 0.8 + 1,
        ),
      ).toBe(true);
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-subagent-details]")).toHaveCount(0);
      await expect(trigger).toBeFocused();
      const inspectorToggle = page.getByRole("button", { name: "展开上下文面板", exact: true });
      if (await inspectorToggle.isVisible()) await inspectorToggle.click();
      await page.getByRole("tab", { name: "上下文", exact: true }).click();
      const sidebarTrigger = page.getByRole("button", {
        name: "查看子代理 缓存研究员 的输出",
        exact: true,
      });
      await sidebarTrigger.click();
      const sidebarDialog = page.locator("[data-subagent-output-dialog]");
      await expect(sidebarDialog).toHaveClass(/agent-operation-detail-dialog/u);
      await expect(sidebarDialog.locator("[data-subagent-details]")).toBeVisible();
      await expect(sidebarDialog.getByText("检查构建缓存键", { exact: true })).toHaveCount(1);
      await expect(sidebarDialog.getByRole("button", { name: /read_file/ })).toBeVisible();
      await expect(sidebarDialog.locator('[data-slot="message-scroller-viewport"]')).toHaveCount(0);
      expect(
        await sidebarDialog.evaluate(
          (element) => element.getBoundingClientRect().height <= window.innerHeight * 0.8 + 1,
        ),
      ).toBe(true);
      if (embedded) expect(childReads).toBe(0);
      else expect(childReads).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(sidebarDialog).toHaveCount(0);
      await expect(sidebarTrigger).toBeFocused();
    });
  }
}
