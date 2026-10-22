import { expect, test } from "./fixtures/app-shell.js";

test("窄中栏始终保留思考量并支持直接切换 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/codexly/t/task-1");
  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("保留思考量与草稿");
  const toolbar = page.locator(".composer-toolbar");
  for (const width of [280, 320, 360, 640]) {
    await input.evaluate((element, nextWidth) => {
      const form = element.closest("form");
      if (!form) throw new Error("Missing composer form");
      form.style.width = `${String(nextWidth)}px`;
      form.style.maxWidth = "100%";
    }, width);
    const reasoning = page.getByRole("button", { name: /^选择思考量：/u });
    await expect(reasoning).toBeVisible();
    await expect
      .poll(() => toolbar.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await reasoning.click();
    const menu = page.getByRole("menu", { name: /^选择思考量/u });
    const option = menu.getByRole("menuitemradio").first();
    const effort = (await option.innerText()).trim();
    await option.click();
    await expect(menu).not.toBeVisible();
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toHaveAccessibleName(`选择思考量：${effort}`);
    await expect(input).toHaveValue("保留思考量与草稿");
  }
});

test("保留配置原始顺序并将模型与思考量放在右侧 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("textbox", { name: "任务输入" }).fill("/plan");
  await page.getByRole("option", { name: /计划/u }).click();
  const toolbar = page.locator(".composer-toolbar");
  // 核对 DOM 与视觉顺序，避免仅用 CSS 排序后键盘焦点仍按错误顺序移动。
  const controls = await toolbar.evaluate((element) =>
    [...element.querySelectorAll("button")]
      .filter(
        (button) =>
          button.getClientRects().length > 0 && getComputedStyle(button).visibility !== "hidden",
      )
      .map((button) => {
        const name = button.getAttribute("aria-label") ?? "";
        return {
          name: name.startsWith("选择模型：")
            ? "模型"
            : name.startsWith("选择思考量：")
              ? "思考量"
              : name,
          x: button.getBoundingClientRect().x,
        };
      })
      .filter((control) =>
        [
          "添加图片或文件",
          "批准模式",
          "沙盒模式",
          "取消计划模式",
          "模型",
          "思考量",
          "提交",
        ].includes(control.name),
      ),
  );
  expect(controls.map((control) => control.name)).toEqual([
    "添加图片或文件",
    "批准模式",
    "沙盒模式",
    "取消计划模式",
    "模型",
    "思考量",
    "提交",
  ]);
  expect(controls.map((control) => control.x)).toEqual(
    controls.map((control) => control.x).sort((left, right) => left - right),
  );
  const model = page.getByRole("button", { name: /^选择模型：/u });
  const bounds = await toolbar.boundingBox();
  expect((await model.boundingBox())?.x).toBeGreaterThan(
    (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
  );
});

test("收起窄中栏配置并保留模型与提交 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/codexly/t/task-1");
  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("保留这段草稿");
  // 固定大窗口，只改变输入区宽度，覆盖拖动分栏而非移动端断点的场景。
  await input.evaluate((element) => {
    const form = element.closest("form");
    if (!form) throw new Error("Missing composer form");
    form.style.width = "360px";
    form.style.maxWidth = "100%";
  });
  const toolbar = page.locator(".composer-toolbar");
  await expect
    .poll(() => toolbar.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  const more = page.getByRole("button", { name: "更多配置", exact: true });
  await expect(more).toBeVisible();
  await expect(page.getByRole("button", { name: /^选择模型：/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批准模式", exact: true })).not.toBeVisible();
  await more.click();
  const config = page.getByRole("dialog", { name: "输入配置", exact: true });
  await expect(config).toBeVisible();
  await config.getByRole("button", { name: "批准模式", exact: true }).click();
  const menu = page.getByRole("menu", { name: "批准模式", exact: true });
  await menu.getByRole("menuitemradio").last().click();
  await expect(config).toBeVisible();
  await expect(config.getByRole("button", { name: "批准模式", exact: true })).toHaveText(
    "从不询问",
  );
  await page.keyboard.press("Escape");
  await expect(config).not.toBeVisible();
  await expect(more).toBeFocused();
  await expect(input).toHaveValue("保留这段草稿");
});
