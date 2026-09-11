import type {
  ScheduledTask,
  ScheduledTaskInput,
  SetScheduledTaskEnabledRequest,
} from "@codexly/protocol";
import type { WebSocketRoute } from "@playwright/test";

import { expect, test, taskSnapshotResponse, tasks as fixtureTasks } from "./fixtures/app-shell.js";

test("preserves custom recurrence on rename and refreshes an automatic run", async ({ page }) => {
  const now = Date.now();
  const schedule = {
    type: "rrule" as const,
    rrule: "RRULE:FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=15;BYSECOND=0;COUNT=5",
    startAtUnixMs: Math.floor((now + 60_000) / 60_000) * 60_000,
    timezone: "America/New_York",
  };
  let task: ScheduledTask = {
    id: "custom-schedule",
    name: "自定义巡检",
    projectId: "codexly",
    projectName: "Codexly",
    enabled: true,
    schedule,
    messageAttachments: [],
    prompt: { attachments: [], skills: [], text: "检查最新改动", type: "prompt" },
    turnOptions: {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    },
    createdAtUnixMs: now,
    updatedAtUnixMs: now,
    nextRunAtUnixMs: now + 60_000,
    lastRunAtUnixMs: null,
    lastRunStatus: null,
    runs: [],
  };
  let savedSchedule: ScheduledTaskInput["schedule"] | undefined;
  let reads = 0;
  let changes: WebSocketRoute | undefined;
  await page.routeWebSocket("**/v1/scheduled-tasks/events", (socket) => {
    changes = socket;
    socket.send(JSON.stringify({ type: "scheduled-tasks.changed" }));
  });
  let projectReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/projects/codexly/tasks") projectReads += 1;
  });
  await page.clock.install({ time: new Date(now) });
  await page.route("**/v1/scheduled-tasks**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/preview")) {
      await route.fulfill({ json: { dates: [now + 86_400_000] } });
      return;
    }
    if (route.request().method() === "GET") {
      reads += 1;
      await route.fulfill({ json: { data: [task] } });
      return;
    }
    const input = route.request().postDataJSON() as ScheduledTaskInput;
    savedSchedule = input.schedule;
    task = { ...task, ...input };
    await route.fulfill({ json: { task } });
  });
  await page.goto("/p/codexly/scheduled");
  await page.getByRole("button", { name: "自定义巡检", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "重复规则" })).toHaveValue("custom");
  await page.getByRole("textbox", { name: "任务名称" }).fill("重命名巡检");
  await page.clock.runFor(250);
  await page.getByRole("button", { name: "保存任务" }).click();
  await expect.poll(() => savedSchedule).toEqual(schedule);
  await expect(page.getByRole("button", { name: "重命名巡检", exact: true })).toBeVisible();
  // 离开定时任务页，仍应发现到期执行并刷新左栏列表。
  await page.getByRole("link", { name: "新建任务", exact: true }).click();
  const readsBeforeRun = reads;
  const projectReadsBeforeRun = projectReads;
  task = {
    ...task,
    nextRunAtUnixMs: now + 2 * 24 * 60 * 60 * 1_000,
    lastRunStatus: "started",
    lastRunAtUnixMs: now + 60_000,
    runs: [
      {
        id: "run-auto",
        status: "started",
        taskId: "automatic-task",
        error: null,
        startedAtUnixMs: now + 60_000,
        finishedAtUnixMs: now + 60_001,
      },
    ],
  };
  await page.clock.fastForward(61_500);
  expect(reads).toBe(readsBeforeRun);
  expect(changes).toBeDefined();
  // 自动到期由服务端发推送，客户端不靠周期性读取来发现执行。
  changes?.send(JSON.stringify({ type: "scheduled-tasks.changed" }));
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRun);
  await expect.poll(() => projectReads).toBeGreaterThan(projectReadsBeforeRun);
  await page.getByRole("link", { name: "定时任务", exact: true }).click();
  await page.getByRole("button", { name: "重命名巡检", exact: true }).click();
  await page.route("**/v1/projects/codexly/tasks/automatic-task", (route) =>
    route.fulfill({ status: 404, json: { message: "Task not found" } }),
  );
  await page.getByRole("button", { name: "automatic-task", exact: true }).click();
  await expect(page.getByText("任务已删除、归档或不可用。", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/scheduled$/u);
  // 已归档任务的快照仍可读，也必须阻止跳转。
  await page.route("**/v1/projects/codexly/tasks/automatic-task", (route) =>
    route.fulfill({
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshotResponse.snapshot, id: "automatic-task" },
      },
    }),
  );
  let archiveChecks = 0;
  await page.route("**/v1/projects/codexly/tasks?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("archived") !== "true")
      return route.fallback();
    archiveChecks += 1;
    await route.fulfill({
      json: { data: [{ ...fixtureTasks[0], id: "automatic-task" }], nextCursor: null },
    });
  });
  await page.getByRole("button", { name: "automatic-task", exact: true }).click();
  await expect.poll(() => archiveChecks).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/scheduled$/u);
});

test("creates, toggles and runs a scheduled task", async ({ page }) => {
  let tasks: readonly ScheduledTask[] = [];
  const mutations: { method: string; path: string }[] = [];
  await page.route("**/v1/scheduled-tasks**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith("/preview")) {
      await route.fulfill({ json: { dates: [Date.now() + 86_400_000] } });
      return;
    }
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
    if (request.method() === "DELETE") {
      tasks = [];
      await route.fulfill({ json: { status: "deleted", taskId: task.id } });
      return;
    }
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

  await expect(page.getByRole("button", { name: "每日巡检", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "每日巡检操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "停用每日巡检" }).click();
  await page.getByRole("button", { name: "已启用", exact: true }).click();
  await expect(page.getByRole("button", { name: "每日巡检", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "任务名称" })).toHaveValue("每日巡检");
  await page.getByRole("button", { name: "已暂停", exact: true }).click();
  await expect(page.getByRole("button", { name: "每日巡检", exact: true })).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: "任务名称" })).toBeVisible();
  await page.screenshot({ path: "test-results/scheduled-tasks-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/scheduled-tasks-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "每日巡检操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "每日巡检", exact: true })).toHaveCount(0);
});
