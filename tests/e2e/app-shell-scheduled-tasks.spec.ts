import type {
  ScheduledTask,
  ScheduledTaskInput,
  SetScheduledTaskEnabledRequest,
} from "@codexly/protocol";

import { expect, test } from "./fixtures/app-shell.js";

test("creates, toggles and runs a scheduled task", async ({ page }) => {
  let tasks: readonly ScheduledTask[] = [];
  const mutations: { method: string; path: string }[] = [];
  await page.route("**/v1/scheduled-tasks**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET") mutations.push({ method: request.method(), path: pathname });

    if (request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: { data: tasks } });
      return;
    }
    if (request.method() === "POST" && pathname === "/v1/scheduled-tasks") {
      const input = request.postDataJSON() as ScheduledTaskInput;
      const now = Date.now();
      const task: ScheduledTask = {
        ...input,
        createdAtUnixMs: now,
        id: "schedule-e2e",
        lastRunAtUnixMs: null,
        lastRunStatus: null,
        nextRunAtUnixMs:
          input.schedule.type === "once" ? input.schedule.atUnixMs : input.schedule.startAtUnixMs,
        runs: [],
        updatedAtUnixMs: now,
      };
      tasks = [task];
      await route.fulfill({ contentType: "application/json", json: { task } });
      return;
    }
    const task = tasks[0];
    if (task === undefined) throw new Error("Expected scheduled task state");
    if (request.method() === "PATCH" && pathname.endsWith("/enabled")) {
      const body = request.postDataJSON() as SetScheduledTaskEnabledRequest;
      const updated = { ...task, enabled: body.enabled, updatedAtUnixMs: Date.now() };
      tasks = [updated];
      await route.fulfill({ contentType: "application/json", json: { task: updated } });
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/run")) {
      await route.fulfill({ contentType: "application/json", json: { task } });
      return;
    }
    await route.fulfill({ contentType: "application/json", status: 404, json: {} });
  });

  await page.goto("/p/codexly");
  await page.getByRole("link", { name: "定时任务" }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/scheduled$/u);
  await page.getByRole("button", { name: "新建定时任务" }).click();
  await page.getByRole("textbox", { name: "任务名称" }).fill("每日巡检");
  await page.getByRole("combobox", { name: "重复规则" }).selectOption("daily");
  await page.getByRole("textbox", { name: "任务输入" }).fill("检查最新改动");
  await page.getByRole("button", { name: "保存任务" }).click();

  await expect(page.getByRole("button", { name: "每日巡检" })).toBeVisible();
  await page.getByRole("switch", { name: "停用每日巡检" }).click();
  await page.getByRole("button", { name: "立即运行" }).click();
  await expect
    .poll(() => mutations)
    .toEqual(
      expect.arrayContaining([
        { method: "POST", path: "/v1/scheduled-tasks" },
        { method: "PATCH", path: "/v1/scheduled-tasks/schedule-e2e/enabled" },
        { method: "POST", path: "/v1/scheduled-tasks/schedule-e2e/run" },
      ]),
    );

  await page.setViewportSize({ width: 390, height: 844 });
  const viewport = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth);
});
