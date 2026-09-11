import { expect, test } from "./fixtures/app-shell.js";

test("自动保存期间保持内容位置、滚动和组件节点稳定", async ({ page }) => {
  let releaseSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/v1/settings", async (route) => {
    if (route.request().method() === "PUT") await saving;
    await route.fallback();
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const region = page.getByRole("region", { name: "全局设置" });
  await region.getByRole("button", { name: "智能体配置", exact: true }).click();
  const panel = page.locator("#settings-panel-agent");
  const control = region.getByRole("combobox", { name: "审批", exact: true });
  await expect(control).toBeVisible();
  const node = await panel.elementHandle();
  const before = await panel.boundingBox();
  const scrollBefore = await region.getByRole("main").evaluate((element) => element.scrollTop);
  try {
    await control.selectOption("never");
    await expect(region.getByRole("status").filter({ hasText: "正在保存" })).toBeVisible();
    expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
    expect((await panel.boundingBox())?.y).toBe(before?.y);
    expect(await region.getByRole("main").evaluate((element) => element.scrollTop)).toBe(
      scrollBefore,
    );
  } finally {
    releaseSave();
  }
  await expect(region.getByRole("status").filter({ hasText: "正在保存" })).toHaveCount(0);
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  expect((await panel.boundingBox())?.y).toBe(before?.y);
  await expect(control).toHaveValue("never");
});
