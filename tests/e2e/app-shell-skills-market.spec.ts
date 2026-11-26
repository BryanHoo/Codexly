import { expect, test } from "./fixtures/app-shell.js";

test("旧扩展地址展示 ACP 智能体管理说明 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/v1\/(skills|plugins|mcp)\//u.test(pathname)) legacyRequests.push(pathname);
  });
  await page.goto("/p/codexly/extensions/plugins");
  await expect(page.getByText("请使用智能体自身提供的设置管理 Skills、MCP 和插件。")).toBeVisible();
  expect(legacyRequests).toEqual([]);
});
