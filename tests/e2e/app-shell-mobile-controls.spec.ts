import { expect, test } from "./fixtures/app-shell.js";

test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });

test("keeps mobile submit square and sidebar actions compact @cross-browser", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  const submit = page.getByRole("button", { name: "提交", exact: true });
  const box = await submit.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBe(box?.height);
  await page.getByRole("button", { name: "展开项目侧栏" }).tap();
  const create = page.getByRole("button", { name: "在 Codexly 中新建任务", exact: true });
  await expect(create).toHaveCSS("opacity", "1");
  expect((await create.boundingBox())?.width).toBeLessThanOrEqual(32);
});

test("anchors approval and sandbox menus to mobile triggers @cross-browser", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  for (const label of ["批准模式", "沙盒模式"]) {
    const trigger = page.getByRole("button", { name: label, exact: true });
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) throw new Error("Missing selector trigger bounds");
    await trigger.tap();
    const menu = page.getByRole("menu", { name: label, exact: true });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
    const box = await menu.boundingBox();
    if (!box) throw new Error("Missing selector menu bounds");
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(312);
    expect(box.y + box.height).toBeLessThanOrEqual(triggerBox.y);
    await menu.getByRole("menuitemradio").last().tap();
    await expect(menu).not.toBeVisible();
  }
});

test("closes mobile sidebar after new and current task navigation @cross-browser", async ({
  page,
}) => {
  await page.goto("/p/codexly/t/task-1");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const open = page.getByRole("button", { name: "展开项目侧栏" });
  await open.tap();
  await sidebar.locator('a[href="/p/codexly/t/task-1"]').first().tap();
  await expect(sidebar).not.toBeVisible();
  await open.tap();
  await sidebar.getByRole("button", { name: "在 Codexly 中新建任务", exact: true }).tap();
  await expect(page).toHaveURL(/\/p\/codexly$/u);
  await expect(sidebar).not.toBeVisible();
  await open.tap();
  await sidebar.getByRole("button", { name: "在 Codexly 中新建任务", exact: true }).tap();
  await expect(sidebar).not.toBeVisible();
  await open.tap();
  await sidebar.getByRole("link", { name: "新建任务", exact: true }).tap();
  await expect(page).toHaveURL(/\/temporary$/u);
  await expect(sidebar).not.toBeVisible();
});

test("exposes touch actions and keeps narrow composer controls on one row @cross-browser", async ({
  page,
}, testInfo) => {
  await page.goto("/p/codexly/t/task-1");
  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("/plan");
  await page.getByRole("option", { name: /计划/u }).tap();
  const mode = page.getByRole("button", { name: "取消计划模式" });
  await expect(mode.locator(".lucide-x")).toHaveCSS("opacity", "1");
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.locator(".composer-toolbar");
    const metrics = await toolbar.evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      controls: [...element.querySelectorAll("button")]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => {
          const box = button.getBoundingClientRect();
          return { center: box.y + box.height / 2, width: box.width };
        }),
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
    expect(new Set(metrics.controls.map((control) => control.center)).size).toBe(1);
    expect(metrics.controls.every((control) => control.width >= 16)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mobile-${String(width)}.png`) });
  }
  await mode.tap();
  await expect(mode).not.toBeVisible();
  await page.getByRole("button", { name: /^上下文(?:已使用|用量)/u }).tap();
  await expect(page.getByRole("dialog", { name: /^上下文(?:已使用|用量)/u })).toBeVisible();
  await page.getByRole("button", { name: "展开项目侧栏" }).tap();
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await expect(sidebar.getByRole("button", { name: "新建任务", exact: true })).toHaveCSS(
    "opacity",
    "1",
  );
  const actions = sidebar.locator(".task-actions").first();
  await expect(actions).toHaveCSS("opacity", "1");
  await actions.tap();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-sidebar.png") });
});
