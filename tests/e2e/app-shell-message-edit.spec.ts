import { expect, taskSnapshot, taskSnapshotRoute, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`编辑用户消息后追加新消息，保留原对话 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const original = "请检查原来的用户需求。";
    const edited = "补充要求：修改后作为全新消息发送。";
    let submissions = 0;
    const oldTurn = {
      id: "edit-original-turn",
      status: "completed",
      error: null,
      startedAt: "2026-11-02T00:00:00Z",
      completedAt: "2026-11-02T00:00:01Z",
      items: [
        { id: "edit-original-user", type: "message", role: "user", text: original },
        {
          id: "edit-original-answer",
          type: "message",
          role: "assistant",
          text: "原回复保持不变。",
        },
      ],
    };
    await page.route(taskSnapshotRoute("task-1"), (route) =>
      route.fulfill({
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          snapshot: { ...taskSnapshot, turns: [oldTurn] },
        },
      }),
    );
    await page.route("**/v1/projects/codexly/submissions", async (route) => {
      submissions += 1;
      const body: unknown = route.request().postDataJSON();
      expect(body).toMatchObject({
        type: "prompt",
        taskId: "task-1",
        input: { type: "prompt", text: edited },
      });
      // 返回新身份的用户条目，验证时间线追加而非替换原回合。
      await route.fulfill({
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          taskId: "task-1",
          turn: {
            id: "edit-new-turn",
            status: "running",
            error: null,
            startedAt: "2026-11-02T00:00:02Z",
            completedAt: null,
            items: [{ id: "edit-new-user", type: "message", role: "user", text: edited }],
          },
        },
      });
    });
    await page.goto("/p/codexly/t/task-1");
    const editor = page.getByRole("textbox", { name: "任务输入" });
    await editor.fill("尚未发送的输入");
    await page.getByRole("button", { name: "编辑为新消息", exact: true }).click();
    await expect(editor).toHaveValue(original);
    await expect(editor).toBeFocused();
    expect(submissions).toBe(0);
    await editor.fill(edited);
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => submissions).toBe(1);
    const users = page.locator('[data-role="user"]');
    await expect(users).toHaveCount(2);
    await expect(users.nth(0)).toContainText(original);
    await expect(users.nth(1)).toContainText(edited);
    await expect(page.getByText("原回复保持不变。", { exact: true })).toBeAttached();
    expect(oldTurn.items[0]?.text).toBe(original);
  });
}
