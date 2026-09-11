import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures/app-shell.js";

test("date pickers share themed calendars and separate date-only selection @cross-browser", async ({
  page,
}) => {
  await page.route("**/v1/scheduled-tasks", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/v1/scheduled-tasks/preview", (route) =>
    route.fulfill({ json: { dates: [] } }),
  );
  await page.goto("/p/codexly/scheduled");
  await page.getByRole("button", { name: "新建定时任务" }).click();
  const time = page.getByRole("textbox", { name: "触发时间", exact: true });
  await time.click();
  const calendar = page.locator(".react-datepicker");
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveCSS("width", "292px");
  await expect(calendar.locator('input[type="time"]')).toBeVisible();
  await page.getByRole("button", { name: "下个月" }).click();
  await page.screenshot({ path: "test-results/scheduled-date-time-picker.png", fullPage: true });
  await time.press("Escape");
  await expect(calendar).toHaveCount(0);
  await page.getByRole("combobox", { name: "重复规则" }).selectOption("custom");
  const start = page.getByRole("textbox", { name: "开始日期", exact: true });
  await start.click();
  await expect(calendar).toBeVisible();
  await expect(calendar.locator('input[type="time"]')).toHaveCount(0);
  await start.press("Escape");
});

test("visual recurrence shares previews and stays within a narrow viewport @cross-browser", async ({
  page,
}) => {
  await page.route("**/v1/scheduled-tasks", (route) => route.fulfill({ json: { data: [] } }));
  const previews: Route[] = [];
  await page.route("**/v1/scheduled-tasks/preview", (route) => {
    previews.push(route);
  });
  await page.goto("/p/codexly/scheduled");
  await page.getByRole("button", { name: "新建定时任务" }).click();
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const repeat = page.getByRole("combobox", { name: "重复规则" });
  await repeat.selectOption("weekends");
  await page.clock.runFor(250);
  await expect.poll(() => previews.length).toBe(1);
  const firstPreview = previews[0];
  if (firstPreview === undefined) throw new Error("Expected first preview");
  expect(firstPreview.request().postDataJSON()).toMatchObject({
    schedule: { rrule: expect.stringContaining("BYDAY=SA,SU") },
  });

  // 请求尚未完成时连续修改：只保留最后一份草稿，旧响应不能覆盖新计划。
  await repeat.selectOption("custom");
  await page.getByRole("spinbutton", { name: "重复间隔" }).fill("2");
  await page.clock.runFor(250);
  expect(previews).toHaveLength(1);
  await firstPreview.fulfill({ json: { dates: [Date.UTC(2030, 0, 1)] } });
  await expect.poll(() => previews.length).toBe(2);
  const secondPreview = previews[1];
  if (secondPreview === undefined) throw new Error("Expected second preview");
  expect(secondPreview.request().postDataJSON()).toMatchObject({
    schedule: { rrule: expect.stringContaining("INTERVAL=2") },
  });
  const dates = Array.from({ length: 5 }, (_, index) => Date.UTC(2030, 0, index + 2, 9, 15));
  await secondPreview.fulfill({ json: { dates } });
  await expect(page.locator(".scheduled-task-preview time")).toHaveCount(3);
  await page.getByRole("button", { name: "展开 5 次" }).click();
  await expect(page.locator(".scheduled-task-preview time")).toHaveCount(5);
  await page.getByRole("textbox", { name: "任务名称" }).fill("重复规则测试");
  await page.getByRole("textbox", { name: "任务输入" }).fill("检查项目");
  await page.clock.runFor(1_000);
  expect(previews).toHaveLength(2);

  await repeat.selectOption("monthly");
  await page.getByRole("button", { name: "最后一天", exact: true }).click();
  await expect(page.getByRole("button", { name: "最后一天", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("group", { name: "每月几号" })).toBeVisible();
  const bounds = await page.getByRole("group", { name: "每月几号" }).boundingBox();
  if (bounds === null) throw new Error("Expected visible month choices");
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/scheduled-recurrence-mobile.png", fullPage: true });
  await page.getByRole("combobox", { name: "每月重复方式" }).selectOption("weekday");
  await page.getByRole("button", { name: "最后一个", exact: true }).click();
  await expect(page.getByRole("button", { name: "最后一个", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "开始与结束条件" }).click();
  await page.getByRole("combobox", { name: "结束", exact: true }).selectOption("count");
  await page.getByRole("spinbutton", { name: "计划次数" }).fill("0");
  await expect(page.getByRole("alert")).toContainText("计划次数需为");
  await expect(page.getByRole("button", { name: "保存任务" })).toBeDisabled();
  await page.clock.runFor(500);
  expect(previews).toHaveLength(2);
});
