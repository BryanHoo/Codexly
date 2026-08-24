import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("keeps a streaming code block within the conversation and copies its code", async ({
  context,
  page,
}) => {
  const streamedCode = `const streamed = "${"x".repeat(2_000)}";`;
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [
                {
                  id: "message-streaming-code",
                  role: "assistant",
                  text: `\`\`\`typescript\n${streamedCode}\n\`\`\``,
                  type: "message",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const copyButton = page.locator('[data-streamdown="code-block-copy-button"]');
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toBeEnabled();
  const conversation = page.getByRole("log", { name: "会话内容" });
  expect(await conversation.evaluate((element) => element.scrollWidth)).toBe(
    await conversation.evaluate((element) => element.clientWidth),
  );
  await copyButton.click();
  await expect
    // Windows 剪贴板会把 LF 转为 CRLF，比较前统一为应用内部换行格式。
    .poll(() =>
      page
        .evaluate(() => navigator.clipboard.readText())
        .then((text) => text.replaceAll("\r\n", "\n")),
    )
    .toBe(`${streamedCode}\n`);
});
