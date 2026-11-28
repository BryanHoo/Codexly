import type {
  ScheduledTask,
  ScheduledTaskInput,
  SetScheduledTaskEnabledRequest,
} from "@codexly/protocol";
import type { WebSocketRoute } from "@playwright/test";

import { expect, test } from "./fixtures/app-shell.js";
import { installedAcpCodex, mockAcpWorkspace } from "./fixtures/acp-defaults.js";
import { parseRequestRecord } from "./fixtures/app-shell-request.js";

test("ACP 定时任务恢复双栏，窄屏可使用已启用的 Agent 保存计划 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const engine = "acp-antigravity";
  await mockAcpWorkspace(page, [
    { ...installedAcpCodex, engine, name: "Antigravity", command: "/bin/antigravity" },
  ]);
  await page.route("**/v1/capabilities", (route) =>
    route.fulfill({
      json: {
        runtime: "acp",
        provider: "codex",
        feedback: { upload: false },
        goals: { clear: false, read: false, update: false },
        skills: { list: false, use: false },
        tasks: { fork: false, list: true, read: true, start: true },
        turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
      },
    }),
  );
  await page.route("**/v1/acp/agents/acp-antigravity/config-cache", (route) =>
    route.fulfill({ json: null }),
  );
  await page.routeWebSocket("**/v1/acp/plans/events", (socket) => {
    socket.send(JSON.stringify({ type: "acp-plans.changed" }));
  });
  let saved: Record<string, unknown> | undefined;
  let savedId: string | undefined;
  let run: Record<string, unknown> | undefined;
  await page.route("**/v1/acp/plans?*", (route) =>
    route.fulfill({ json: { data: [], nextCursor: null } }),
  );
  await page.route(/\/v1\/acp\/plans\/[^/]+\/history$/u, (route) =>
    route.fulfill({ json: { projectId: "codexly", data: [] } }),
  );
  await page.route(/\/v1\/acp\/plans\/[^/]+\/run$/u, (route) => {
    run = parseRequestRecord(route.request().postData());
    return route.fulfill({ json: { runId: run["runId"] } });
  });
  await page.route(/\/v1\/acp\/plans\/[^/]+$/u, async (route) => {
    if (route.request().method() === "PUT") {
      saved = parseRequestRecord(route.request().postData());
      savedId = new URL(route.request().url()).pathname.split("/").at(-1);
    }
    await route.fulfill({
      json: {
        source: "web",
        scheduleId: savedId,
        revision: 1,
        definition: saved?.["definition"],
        state: { revision: 1, definitionRevision: 1, nextRunAt: null },
        canEdit: true,
        resources: [],
      },
    });
  });
  await page.goto("/p/codexly/scheduled");
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  const list = page.locator(".acp-plan-workspace .scheduled-task-list");
  const editor = page.getByRole("region", { name: "新建计划" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "任务输入" })).toBeVisible({
    timeout: 3000,
  });
  await expect
    .poll(async () => ((await editor.boundingBox())?.x ?? 0) - ((await list.boundingBox())?.x ?? 0))
    .toBeGreaterThan(200);

  // 使用生产构建的样式验证窄屏换行与保存能力。
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => ((await editor.boundingBox())?.y ?? 0) - ((await list.boundingBox())?.y ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(() => editor.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  await editor.getByRole("textbox", { name: "计划名称" }).fill("每天巡检");
  await editor.getByRole("textbox", { name: "任务输入" }).fill("检查项目");
  await expect(editor.locator("[data-acp-model-trigger]")).toBeVisible();
  await editor.getByRole("button", { name: "保存计划" }).click();
  await expect
    .poll(() => saved?.["definition"])
    .toMatchObject({ engine, name: "每天巡检", prompt: { text: "检查项目" } });
  await page.getByRole("button", { name: "立即运行", exact: true }).click();
  await expect
    .poll(() => run)
    .toMatchObject({ expectedRevision: 1, expectedStateRevision: 1, runId: expect.any(String) });
});

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
    await route.fulfill({ json: { task, tasks: { data: [task] } } });
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
  let navigationReads = 0;
  let legacyArchiveReads = 0;
  await page.route("**/v1/projects/codexly/tasks/automatic-task/navigation", (route) => {
    navigationReads += 1;
    return route.fulfill({ json: { task: null } });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/projects/codexly/tasks" && url.searchParams.has("archived")) {
      legacyArchiveReads += 1;
    }
  });
  await page.getByRole("button", { name: "automatic-task", exact: true }).click();
  await expect(page.getByText("任务已删除、归档或不可用。", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/scheduled$/u);
  await page.getByRole("button", { name: "automatic-task", exact: true }).click();
  expect(navigationReads).toBe(2);
  expect(legacyArchiveReads).toBe(0);
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
      await route.fulfill({
        contentType: "application/json",
        json: { task, tasks: { data: [task] } },
      });
      return;
    }
    const task = tasks[0];
    if (task === undefined) throw new Error("Expected scheduled task state");
    if (request.method() === "DELETE") {
      tasks = [];
      await route.fulfill({ json: { status: "deleted", taskId: task.id, tasks: { data: tasks } } });
      return;
    }
    if (request.method() === "PATCH" && pathname.endsWith("/enabled")) {
      const body = request.postDataJSON() as SetScheduledTaskEnabledRequest;
      const updated = { ...task, enabled: body.enabled, updatedAtUnixMs: Date.now() };
      tasks = [updated];
      await route.fulfill({
        contentType: "application/json",
        json: { task: updated, tasks: { data: tasks } },
      });
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/run")) {
      await route.fulfill({
        contentType: "application/json",
        json: { task, tasks: { data: [task] } },
      });
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
  const deleteDialog = page.getByRole("dialog", { name: "永久删除任务", exact: true });
  await expect(deleteDialog).toBeVisible();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "每日巡检", exact: true })).toHaveCount(0);
});
