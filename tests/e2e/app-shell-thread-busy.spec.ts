import { expect, taskSnapshot, taskSnapshotRoute, test } from "./fixtures/app-shell.js";

for (const { width, theme } of [390, 1280].flatMap((width) =>
  ["light", "dark"].map((theme) => ({ width, theme })),
)) {
  test(`其他应用占用时仍显示历史并禁用发送 ${String(width)}px ${theme} @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    let submissions = 0;
    await page.route("**/v1/projects/codexly/submissions", (route) => {
      submissions += 1;
      return route.abort();
    });
    await page.route(taskSnapshotRoute("task-1"), (route) =>
      route.fulfill({
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          snapshot: {
            ...taskSnapshot,
            runtime: "acp",
            settings: undefined,
            writeAccess: "external",
          },
        },
      }),
    );
    await page.goto("/p/codexly/t/task-1");
    await page.evaluate((scheme) => {
      document.documentElement.dataset["theme"] = scheme;
      document.documentElement.style.colorScheme = scheme;
    }, theme);
    await expect(page.locator("[data-composer-write-notice]")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(
      await page
        .locator("[data-composer-write-notice]")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await expect(
      page.getByRole("textbox", { name: "任务输入", includeHidden: true }),
    ).toBeDisabled();
    await expect(page.locator('[data-composer-write-access="external"] fieldset')).toHaveAttribute(
      "inert",
      "",
    );
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible();
    const form = page.locator("form[data-prompt-input]");
    const frame = await form.boundingBox();
    const overlay = await page.locator("[data-composer-write-notice]").boundingBox();
    if (!frame || !overlay) throw new Error("缺少输入框或占用提示");
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(frame[key] - overlay[key])).toBeLessThanOrEqual(2);
    }
    await page.screenshot({ path: `.local/composer-locked-${String(width)}-${theme}.png` });
    expect(submissions).toBe(0);
  });
}
