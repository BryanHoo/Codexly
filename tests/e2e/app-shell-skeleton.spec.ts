import { expect, taskSnapshotRoute, test } from "./fixtures/app-shell.js";

for (const width of [390, 1440]) {
  test(`${width}px: 会话首载显示骨架并在内容到达后切换 @cross-browser`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: width === 390 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 用确定的请求屏障观察加载阶段，避免依赖网络速度或固定延时。
    await page.route(taskSnapshotRoute("task-1"), async (route) => {
      await pending;
      await route.fallback();
    });
    try {
      await page.goto("/p/codexly/t/task-1");
      const loading = page.locator('[data-slot="loading-skeleton"][data-variant="conversation"]');
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("role", "status");
      await expect(loading).toContainText("正在加载");
      await expect(loading.locator('[data-slot="skeleton"]').first()).toHaveCSS(
        "animation-name",
        "none",
      );
      const bounds = await loading.evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
      release();
      await expect(loading).toHaveCount(0);
      await expect(
        page.getByText("完成 macOS 原生风格的三栏工作台页面。", { exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
  });
}
