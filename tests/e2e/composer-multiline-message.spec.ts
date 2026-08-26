import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test("submits and renders the live multiline editor text @cross-browser", async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "multiline-turn",
          items: [],
          startedAt: "2026-08-18T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("第一行");
  await expect(prompt).toHaveAttribute("data-serialized-value", "第一行");

  // 使用真实按键覆盖各浏览器对 contentEditable 换行 DOM 的平台差异。
  await prompt.press("Shift+Enter");
  await expect(prompt).toHaveAttribute("data-serialized-value", "第一行\n");
  await prompt.pressSequentially("第二行");
  await expect(prompt).toHaveAttribute("data-serialized-value", "第一行\n第二行");
  await expect
    .poll(() => prompt.evaluate((editor) => editor.textContent.includes("\u200b")))
    .toBe(false);
  await prompt.press("Enter");

  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [],
    text: "第一行\n第二行",
    type: "prompt",
  });

  const submittedMessage = page.locator('article[data-role="user"]').last();
  const messageResponse = submittedMessage.locator('[data-message-text="true"] > div > div');
  await expect(submittedMessage).toContainText("第一行\n第二行");
  await expect(messageResponse).toHaveCSS("white-space", "pre-wrap");
  await expect
    .poll(() =>
      messageResponse.locator("p").evaluate((paragraph) => {
        const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
        return paragraph.getBoundingClientRect().height > lineHeight * 1.5;
      }),
    )
    .toBe(true);
});
