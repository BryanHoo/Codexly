import { expect, test } from "./fixtures/app-shell.js";

for (const width of [480, 1440]) {
  test(`检查更新后连续点击原位置不会开始安装（宽度 ${String(width)}） @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let available = false;
    let checks = 0;
    let installs = 0;
    await page.route(/\/v1\/app-info(?:\?.*)?$/u, async (route) => {
      checks += 1;
      await route.fulfill({
        json: {
          appVersion: "1.3.0",
          codexVersion: "0.164.0",
          latestVersion: available ? "1.4.0" : null,
          releaseNotes: null,
          status: available ? "available" : "current",
          updateAvailable: available,
        },
      });
    });
    await page.route("**/v1/app-update", async (route) => {
      installs += 1;
      await route.abort();
    });
    await page.goto("/p/codexly/t/task-1");
    if (width < 768) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.locator("#global-settings-about-trigger").click();
    const settings = page.getByRole("region", { name: "全局设置" });
    const check = settings.getByRole("button", { name: "检查更新", exact: true });
    await expect(check).toBeEnabled();
    const before = await check.boundingBox();
    if (before === null) throw new Error("检查更新按钮缺少布局边界");
    const row = await settings
      .getByText("软件更新", { exact: true })
      .locator("../..")
      .boundingBox();
    if (row === null) throw new Error("软件更新行缺少布局边界");
    // 宽屏和移动端都以字段右边界对齐，版本状态变化后仍保留原检查入口。
    expect(Math.abs(before.x + before.width - row.x - row.width)).toBeLessThan(1);
    available = true;
    await check.click();
    await expect(settings.getByRole("button", { name: "更新到 1.4.0" })).toBeVisible();
    const checked = checks;
    // 使用同一坐标再次点击，覆盖状态变化后按钮移动造成的误安装。
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
    await expect.poll(() => checks).toBeGreaterThan(checked);
    expect(installs).toBe(0);
    expect((await check.boundingBox())?.x).toBe(before.x);
  });
}
