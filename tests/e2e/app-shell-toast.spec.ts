import { expect, test } from "./fixtures/app-shell.js";

for (const width of [320, 1440]) {
  test(`${String(width)}px: 操作错误使用官方 Toast 并保留输入与键盘关闭能力 @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: width === 320 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const message = "请求失败：" + "请检查当前服务连接。".repeat(15);
    await page.route("**/v1/projects/codexly/submissions", async (route) => {
      await route.fulfill({
        status: 502,
        json: { code: "PROVIDER_ERROR", message, retryable: true },
      });
    });
    await page.goto("/p/codexly");
    const prompt = page.getByRole("textbox", { name: "任务输入" });
    await prompt.fill("失败后保留草稿");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    const card = page.locator('[data-slot="toast"][data-type="error"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-slot="toast-title"]')).toHaveText(message);
    await expect(card).toHaveCSS("transition-duration", "0s");
    const box = await card.boundingBox();
    if (!box) throw new Error("Toast 缺少布局边界");
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
    expect(Math.round(box.y + box.height)).toBe(884);
    await expect(prompt).toHaveAttribute("data-serialized-value", "失败后保留草稿");
    // F6 由 Base UI 定位通知区域，Tab 进入卡片和关闭按钮；关闭后应恢复原焦点。
    await prompt.focus();
    await page.keyboard.press("F6");
    await expect(page.getByRole("region", { name: "通知" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: "关闭通知" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);
    await expect(prompt).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("触屏长正文可滚动，卡片边缘可向右滑动关闭", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "使用 Chromium CDP 注入真实触摸事件");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/v1/projects/codexly/submissions", async (route) => {
    await route.fulfill({
      status: 502,
      json: { code: "PROVIDER_ERROR", message: "长错误内容".repeat(180), retryable: true },
    });
  });
  await page.goto("/p/codexly");
  await page.getByRole("textbox", { name: "任务输入" }).fill("验证触屏提示");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  const card = page.locator('[data-slot="toast"]');
  await expect(card).toBeVisible();
  const text = card.locator('[data-slot="toast-text"]');
  const textBounds = await text.boundingBox();
  if (!textBounds) throw new Error("Toast 正文缺少布局边界");
  const session = await page.context().newCDPSession(page);
  async function swipe(x: number, y: number, dx: number, dy: number) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const step of [0.25, 0.5, 1]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + dx * step, y: y + dy * step }],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  try {
    // 正文手势应交给原生滚动区，不能误触发整条通知的滑动关闭。
    await swipe(
      textBounds.x + textBounds.width / 2,
      textBounds.y + textBounds.height * 0.75,
      0,
      -120,
    );
    await expect.poll(() => text.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(card).toBeVisible();
    const icon = await card.locator('[data-slot="toast-icon"]').boundingBox();
    if (!icon) throw new Error("Toast 图标缺少布局边界");
    await swipe(icon.x + icon.width / 2, icon.y + icon.height / 2, 130, 0);
    await expect(card).toHaveCount(0);
  } finally {
    await session.detach();
  }
});
