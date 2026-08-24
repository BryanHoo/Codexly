import { expect, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("keeps the compact mobile workbench inside the dynamic viewport @cross-browser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1, viewport-fit=cover",
  );

  const composer = page.getByRole("region", { name: "消息编辑器" });
  const composerFooter = composer.locator("form > div:last-child");
  const modelSelector = page.getByRole("button", { name: /^模型和思考量：/u });
  const composerControls = [
    page.getByRole("button", { name: "添加图片或文件" }),
    page.getByRole("combobox", { name: "批准模式" }),
    modelSelector,
    page.getByRole("button", { name: "提交", exact: true }),
  ];
  const touchButtons = [
    page.getByRole("button", { name: "展开项目侧栏" }),
    page.getByRole("button", { name: "展开上下文面板" }),
    page.getByRole("button", { name: "添加图片或文件" }),
    page.getByRole("button", { name: "提交", exact: true }),
  ];
  const touchControls = [...touchButtons, ...composerControls.slice(1, 3)];

  // 最窄支持宽度必须同时保证页面边界、Composer 内部布局和触控尺寸。
  const composerMetrics = await composerFooter.evaluate((element) => ({
    children: [...element.children].map((child) => ({
      height: child.getBoundingClientRect().height,
      width: child.getBoundingClientRect().width,
    })),
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }));
  expect(composerMetrics.scrollWidth, JSON.stringify(composerMetrics)).toBeLessThanOrEqual(
    composerMetrics.clientWidth,
  );
  expect(composerMetrics.scrollHeight, JSON.stringify(composerMetrics)).toBeLessThanOrEqual(
    composerMetrics.clientHeight,
  );

  const controlBoxes = await Promise.all(touchControls.map((control) => control.boundingBox()));
  for (const box of controlBoxes) {
    expect(box).not.toBeNull();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  for (const control of touchButtons) {
    await expect(control).toHaveAttribute("data-size", /.+/u);
    await expect(control).toHaveAttribute("data-variant", /.+/u);
  }
  const composerControlBoxes = await Promise.all(
    composerControls.map((control) => control.boundingBox()),
  );
  for (const box of composerControlBoxes) expect(box?.y).toBe(composerControlBoxes[0]?.y);
  expect((await composerFooter.boundingBox())?.height).toBeLessThanOrEqual(52);

  await composerControls[2]?.click();
  const mobileModelDialog = page.getByRole("dialog", { name: "模型和思考量" });
  await expect(mobileModelDialog.getByRole("radio")).toHaveCount(4);
  await expect(mobileModelDialog).not.toContainText("适合复杂编码任务");
  const mobileModelDialogBox = await mobileModelDialog.boundingBox();
  expect(mobileModelDialogBox).not.toBeNull();
  expect(mobileModelDialogBox?.x ?? -1).toBeGreaterThanOrEqual(8);
  expect((mobileModelDialogBox?.x ?? 0) + (mobileModelDialogBox?.width ?? 0)).toBeLessThanOrEqual(
    312,
  );
  expect(mobileModelDialogBox?.y ?? -1).toBeGreaterThanOrEqual(8);
  expect((mobileModelDialogBox?.y ?? 0) + (mobileModelDialogBox?.height ?? 0)).toBeLessThanOrEqual(
    560,
  );
  expect(mobileModelDialogBox?.width).toBeLessThanOrEqual(304);
  await mobileModelDialog.getByRole("radio", { name: "GPT-5.6 Terra" }).click();
  await expect(mobileModelDialog).not.toBeVisible();
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Terra，中");
  await modelSelector.click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "展开上下文面板" }).click();
  const inspectorClose = page
    .getByRole("complementary", { name: "运行环境" })
    .getByRole("button", { name: "关闭上下文面板" });
  await expect(inspectorClose).toBeVisible();
  expect((await inspectorClose.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await inspectorClose.click();
  await expect(page.getByRole("complementary", { name: "运行环境" })).not.toBeVisible();

  expect(
    await page.evaluate(() => ({
      bodyHeight: document.body.getBoundingClientRect().height,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    })),
  ).toEqual({
    bodyHeight: 568,
    documentHeight: 568,
    documentWidth: 320,
    viewportHeight: 568,
    viewportWidth: 320,
  });
});

test("keeps mobile diff dialogs inside the viewport without squeezing review content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/p/code-agent/t/task-1");

  await page
    .getByRole("button", { name: /打开 Diff/u })
    .first()
    .click();
  const diffDialog = page.getByRole("dialog");
  const diffSurface = diffDialog.locator(":scope > section");
  await expect(diffDialog.locator(".file-diff-renderer")).toBeVisible();
  expect(await diffSurface.evaluate((surface) => surface.scrollWidth <= surface.clientWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "关闭文件 Diff" }).click();

  await page
    .getByRole("region", { name: /本次修改了 \d+ 个文件/u })
    .getByRole("button", { name: "审核", exact: true })
    .click();
  const reviewDialog = page.getByRole("dialog");
  const reviewContent = reviewDialog.getByRole("region", { name: "审核文件内容" });
  const reviewNavigation = reviewDialog.getByRole("complementary", { name: "变更文件导航" });
  await expect(reviewDialog.locator(".file-diff-renderer")).toBeVisible();
  await expect(reviewNavigation).not.toBeVisible();

  const collapsedDialogBox = await reviewDialog.boundingBox();
  const collapsedContentBox = await reviewContent.boundingBox();
  expect(collapsedDialogBox).not.toBeNull();
  expect(collapsedContentBox?.width).toBe(collapsedDialogBox?.width);

  const expandNavigation = reviewDialog.getByRole("button", { name: "展开变更文件导航" });
  expect((await expandNavigation.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expandNavigation.click();
  await expect(reviewNavigation).toBeVisible();
  const [expandedDialogBox, expandedContentBox, navigationBox] = await Promise.all([
    reviewDialog.boundingBox(),
    reviewContent.boundingBox(),
    reviewNavigation.boundingBox(),
  ]);
  expect(expandedContentBox?.width).toBe(expandedDialogBox?.width);
  expect(navigationBox?.x).toBeGreaterThan(expandedContentBox?.x ?? 0);
  expect((navigationBox?.x ?? 0) + (navigationBox?.width ?? 0)).toBeLessThanOrEqual(
    (expandedDialogBox?.x ?? 0) + (expandedDialogBox?.width ?? 0),
  );

  await reviewDialog.getByRole("button", { name: "收起变更文件导航" }).click();
  await expect(reviewNavigation).not.toBeVisible();
});

test("closes open workbench panels when the window becomes narrow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/code-agent/t/task-1");

  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "运行环境" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole("complementary", { name: "项目侧栏" })).not.toBeVisible();
  await expect(page.getByRole("complementary", { name: "运行环境" })).not.toBeVisible();
});

test("renders a route-level not-found state", async ({ page }) => {
  await page.goto("/missing-route");

  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
});
