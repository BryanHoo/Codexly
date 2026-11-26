import { expect, test } from "./fixtures/app-shell.js";

test("产品名称失焦后同步更新侧栏和浏览器标题 @cross-browser", async ({ page }) => {
  const productName = "研发工作台 <Lab> ✨ ".repeat(8).trim();
  await page.goto("/p/codexly");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const openSettings = sidebar.getByRole("button", { name: "设置", exact: true });
  await expect(sidebar.getByRole("img", { name: "Codexly", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Codexly");

  await openSettings.click();
  const settings = page.getByRole("dialog", { name: "全局设置" });
  const name = settings.getByRole("textbox", { name: "产品名称", exact: true });
  const language = settings.getByRole("combobox", { name: "语言", exact: true });
  const readEdges = (control: Element) => {
    const { left, right } = control.getBoundingClientRect();
    return { left, right };
  };
  await expect(name).toHaveAttribute("data-variant", "outline");
  await expect(name).toHaveCSS("height", "32px");
  expect(await name.evaluate(readEdges)).toEqual(await language.evaluate(readEdges));
  await expect(settings.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await name.fill(` ${productName} `);
  await expect(page).toHaveTitle("Codexly");
  await name.press("Tab");
  await expect(page).toHaveTitle(productName);
  await expect(name).toHaveValue(productName);
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  const brand = sidebar.getByText(productName, { exact: true });
  await expect(brand).toBeVisible();
  await expect
    .poll(() => brand.evaluate((label) => label.scrollWidth > label.clientWidth))
    .toBe(true);
  await expect(sidebar.getByRole("button", { name: "全局搜索", exact: true })).toBeInViewport();

  await page.reload();
  await expect(page).toHaveTitle(productName);
  await expect(brand).toBeVisible();
  await page.goto("/p/codexly/file?path=README.md&previewKind=source");
  await expect(page).toHaveTitle("README.md");
  await page.goBack();
  await expect(page).toHaveTitle(productName);
  await expect(brand).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page).toHaveTitle(productName);
  await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
  await expect(brand).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "全局搜索", exact: true })).toBeInViewport();
  await openSettings.click();
  await expect(name).toHaveValue(productName);
  await expect(name).toHaveCSS("height", "32px");
  expect(await name.evaluate(readEdges)).toEqual(await language.evaluate(readEdges));
  await name.fill("");
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page).toHaveTitle("Codexly");
});
