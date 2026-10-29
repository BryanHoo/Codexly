import { expect, test } from "./fixtures/app-shell.js";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`Tooltip ${colorScheme}`, () => {
    test.use({ colorScheme, viewport: { width: 1440, height: 900 } });

    test("keeps keyboard hints dismissible and hover content readable @cross-browser", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/p/codexly/t/task-1");
      const action = page.getByRole("button", { name: "在 Codexly 中新建任务", exact: true });
      // 先切换键盘模态，再定位控件；兼容 macOS WebKit 的系统 Tab 偏好。
      await page.keyboard.press("Tab");
      await action.focus();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText("在 Codexly 中新建任务");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveCSS("transition-property", "none");
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await expect(action).toBeFocused();

      await action.blur();
      await action.hover();
      await expect(tooltip).toBeVisible();
      await tooltip.hover();
      await expect(tooltip).toBeVisible();
      const colors = await tooltip.evaluate((element) => {
        const style = getComputedStyle(element);
        const arrow = element.querySelector('[data-slot="tooltip-arrow"]');
        return {
          foreground: style.color,
          background: style.backgroundColor,
          arrow: arrow ? getComputedStyle(arrow).backgroundColor : null,
        };
      });
      expect(colors.foreground).not.toBe(colors.background);
      expect(colors.arrow).toBe(colors.background);
      await page.getByRole("textbox", { name: "任务输入" }).click();
      await expect(tooltip).toHaveCount(0);
    });
  });
}

test.describe("Tooltip touch", () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });

  test("touch opens the composer configuration without leaving a tooltip @cross-browser", async ({
    page,
  }) => {
    await page.goto("/p/codexly/t/task-1");
    await page.getByRole("button", { name: "更多配置", exact: true }).tap();
    const configuration = page.getByRole("dialog", { name: "输入配置", exact: true });
    await expect(configuration).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.getByRole("button", { name: "更多配置", exact: true }).tap();
    await expect(configuration).not.toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
});
