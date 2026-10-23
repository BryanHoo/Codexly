import { expect, test } from "./fixtures/app-shell.js";

test("Web 帮助展示当前平台可用快捷键并支持关闭 @cross-browser", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "帮助", exact: true }).click();
  await page.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "键盘快捷键" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("全局搜索", { exact: true })).toBeVisible();
  const splitRight = dialog.getByRole("listitem").filter({ hasText: "向右分屏" });
  const mac = await page.evaluate(() => /mac/i.test(navigator.platform));
  await expect(splitRight).toContainText(mac ? "⌥Shift→" : "AltShift→");
  // Web 未注册桌面全局命令，不能将浏览器的原生快捷键误报为应用功能。
  await expect(dialog.getByText("新建任务", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("显示或隐藏终端", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("分屏采用简短按键并保留旧 Chrome 标签页组合 @cross-browser", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  await expect(page.getByRole("button", { name: "分屏布局", exact: true })).toBeVisible();
  const mac = await page.evaluate(() => /mac/i.test(navigator.platform));
  // 记录旧组合未被页面取消；真实浏览器的保留按键行为以 Chrome 官方清单为依据。
  const oldPrevented = await page.evaluate((isMac) => {
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      code: "ArrowRight",
      altKey: true,
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }, mac);
  expect(oldPrevented).toBe(false);
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(page.locator("[data-document-workspace]")).toHaveCount(2);
});
