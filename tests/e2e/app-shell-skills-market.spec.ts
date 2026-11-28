import { expect, test } from "./fixtures/app-shell.js";

test("旧扩展中心地址显示对应工作区的新聊天 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/p/codexly/extensions/plugins", "/temporary/extensions/skills"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "新聊天", exact: true })).toBeVisible();
  }
});
