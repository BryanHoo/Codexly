import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

const originalText = "# Clipboard regression\n\n**original Markdown**\n\n  keep whitespace\n";

for (const mode of ["unavailable", "denied"] as const) {
  test(`copies original messages when Clipboard API is ${mode} @cross-browser`, async ({
    page,
    browserName,
  }) => {
    await page.addInitScript((mode) => {
      const nativeClipboard = navigator.clipboard;
      // oxlint-disable-next-line typescript/no-deprecated -- 保留真实降级接口，验证复制而非模拟成功。
      const execCommand = document.execCommand.bind(document);
      // 保留读取接口用于验证真实剪贴板，只模拟写入 API 的部署限制。
      Object.defineProperty(window, "__readClipboard", {
        value: () => nativeClipboard.readText(),
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          mode === "unavailable"
            ? undefined
            : {
                writeText: () =>
                  Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
              },
      });
      // oxlint-disable-next-line typescript/no-deprecated -- 记录真实降级复制结果。
      document.execCommand = (command, ...args) => {
        const text =
          document.activeElement instanceof HTMLTextAreaElement
            ? document.activeElement.value
            : null;
        // oxlint-disable-next-line typescript/no-deprecated -- 调用保留的浏览器接口。
        const success = execCommand(command, ...args);
        if (command === "copy" && success)
          Object.defineProperty(window, "__copiedText", { configurable: true, value: text });
        return success;
      };
    }, mode);
    await page.route("**/v1/projects/codexly/tasks/task-1", (route) =>
      route.fulfill({
        contentType: "application/json",
        json: {
          ...taskSnapshotResponse,
          snapshot: {
            ...taskSnapshot,
            turns: [
              {
                ...taskSnapshot.turns[0],
                items: [
                  {
                    id: "clipboard-message",
                    role: "assistant",
                    text: originalText,
                    type: "message",
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    await page.goto("/p/codexly/t/task-1");
    const copy = page.getByRole("button", { name: "复制消息", exact: true }).last();
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
    const copied = await page.evaluate(
      () => (window as unknown as { __copiedText: string }).__copiedText,
    );
    expect(copied).toBe(originalText);
    if (browserName === "chromium") {
      // Windows 系统剪贴板将换行转换为 CRLF；原始复制文本已在上方严格校验。
      const readClipboard = async () =>
        (
          await page.evaluate(() =>
            (window as unknown as { __readClipboard: () => Promise<string> }).__readClipboard(),
          )
        ).replace(/\r\n/gu, "\n");
      await expect.poll(readClipboard).toBe(copied);
    }
    await expect(page.locator('textarea[aria-hidden="true"]')).toHaveCount(0);
  });
}

test("copies messages on mobile without Clipboard API", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined }),
  );
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "复制消息", exact: true }).last().click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  await expect(page.locator('textarea[aria-hidden="true"]')).toHaveCount(0);
});
