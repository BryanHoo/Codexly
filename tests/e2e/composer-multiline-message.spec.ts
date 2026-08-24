import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test("submits and renders the live multiline editor text", async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
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

  // 模拟 Windows 在 React 隐藏字段提交前同步派发换行输入与表单提交。
  await prompt.evaluate((editor) => {
    editor.replaceChildren(
      document.createTextNode("第一行"),
      document.createElement("br"),
      document.createTextNode("第二行"),
    );
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }));
    editor.closest("form")?.requestSubmit();
  });

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
