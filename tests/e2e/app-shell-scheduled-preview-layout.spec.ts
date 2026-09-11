import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures/app-shell.js";

test("preview recalculation preserves editor height and scroll position @cross-browser", async ({
  page,
}) => {
  const requests: Route[] = [];
  await page.route("**/v1/scheduled-tasks", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/v1/scheduled-tasks/preview", (route) => {
    requests.push(route);
  });
  await page.goto("/p/codexly/scheduled");
  await page.getByRole("button", { name: "新建定时任务" }).click();
  await page.getByRole("combobox", { name: "重复规则" }).selectOption("daily");
  await expect.poll(() => requests.length).toBe(1);
  const first = requests[0];
  if (!first) throw new Error("Expected preview request");
  const dates = Array.from({ length: 5 }, (_, index) => Date.UTC(2030, 0, index + 1, 9));
  await first.fulfill({ json: { dates } });
  await expect(page.locator(".scheduled-task-preview time")).toHaveCount(3);
  const editor = page.locator(".scheduled-task-editor");
  const measure = () =>
    editor.evaluate((element) => ({ height: element.scrollHeight, top: element.scrollTop }));
  await editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const ready = await measure();
  await page.locator('.scheduled-task-fields input[type="time"]').fill("10:30");
  // 修改前、等待响应和新结果显示后，编辑区高度及滚动位置必须相同。
  await expect.poll(() => requests.length).toBe(2);
  const pending = await measure();
  expect(pending).toEqual(ready);
  const second = requests[1];
  if (!second) throw new Error("Expected second preview request");
  await second.fulfill({ json: { dates: dates.map((date) => date + 5_400_000) } });
  await expect(page.locator(".scheduled-task-preview")).toHaveAttribute("aria-busy", "false");
  expect(await measure()).toEqual(pending);
  await page.getByRole("button", { name: "展开 5 次" }).click();
  await editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const expanded = await measure();
  await page.locator('.scheduled-task-fields input[type="time"]').fill("11:30");
  await expect.poll(() => requests.length).toBe(3);
  expect(await measure()).toEqual(expanded);
  const third = requests[2];
  if (!third) throw new Error("Expected third preview request");
  await third.fulfill({ status: 500, json: { message: "Preview failed" } });
  await expect(page.getByRole("button", { name: "重新计算" })).toBeVisible();
  expect(await measure()).toEqual(expanded);
  await page.locator('.scheduled-task-fields input[type="time"]').fill("");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await measure()).toEqual(expanded);
});
