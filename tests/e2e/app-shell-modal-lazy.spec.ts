import { expect, test } from "./fixtures/app-shell.js";

test("Dialog 和 Drawer 首次打开才请求渲染模块，重开复用缓存 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = { dialog: 0, drawer: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/dialog-surface-[^/]+\.js$/u.test(path)) requests.dialog++;
    if (/\/drawer-surface-[^/]+\.js$/u.test(path)) requests.drawer++;
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
  const pinned = page.locator('[data-sidebar-shortcut-group="pinned"]');
  const trigger = pinned.getByRole("button", { name: /已固定：/u });
  await expect(trigger).toBeVisible();
  expect(requests).toEqual({ dialog: 0, drawer: 0 });

  // 真实生产资源请求验证拆包；不能仅依据组件是否隐藏来推断按需加载。
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: /已固定/u });
  await expect(drawer).toBeVisible();
  expect(requests).toEqual({ dialog: 0, drawer: 1 });
  await drawer.getByRole("button", { name: "关闭任务列表", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(drawer).toBeVisible();
  expect(requests.drawer).toBe(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await page.getByRole("button", { name: "帮助", exact: true }).click();
  await page.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "键盘快捷键" });
  await expect(dialog).toBeVisible();
  expect(requests).toEqual({ dialog: 1, drawer: 1 });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "帮助", exact: true }).click();
  await page.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(requests.dialog).toBe(1);
});
