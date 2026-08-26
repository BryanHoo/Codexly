import { chooseHostAttachment, expect, taskSnapshot, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("selects, clears, and submits goal mode", async ({ page }) => {
  let turnBody: unknown;
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-goal",
          items: [],
          startedAt: "2026-08-05T13:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  await prompt.fill("/goal");
  await expect(commandMenu.getByRole("option", { name: /目标/u })).toBeVisible();
  await prompt.press("Enter");

  const goalModeTag = page.getByRole("button", { name: "取消目标模式" });
  await expect(goalModeTag).toBeVisible();
  await expect
    .poll(() =>
      sandboxSelect.evaluate(
        (element) => element.nextElementSibling?.hasAttribute("data-goal-mode") ?? false,
      ),
    )
    .toBe(true);
  await goalModeTag.hover();
  await expect(goalModeTag.locator("svg").last()).toHaveCSS("opacity", "1");
  await goalModeTag.click();
  await expect(goalModeTag).toHaveCount(0);

  await prompt.fill("/goal");
  await prompt.press("Enter");
  await prompt.fill("仅回复 GOAL_MODE_CHECK，不修改文件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByRole("button", { name: "取消目标模式" })).toHaveCount(0);
  expect(turnBody).toEqual({
    input: {
      attachments: [],
      skills: [],
      text: "仅回复 GOAL_MODE_CHECK，不修改文件",
      type: "prompt",
    },
    options: {
      ...taskSnapshot.settings,
      goalMode: true,
    },
  });
});

test("shows persisted goal state and sends lifecycle controls", async ({ page }) => {
  const goal = {
    createdAt: "2026-08-25T00:00:00.000Z",
    objective: "完成官方 Goal 生命周期对接",
    status: "paused" as const,
    timeUsedSeconds: 90,
    tokenBudget: 20_000,
    tokensUsed: 4_096,
    updatedAt: "2026-08-25T00:01:30.000Z",
  };
  const requests: { body: unknown; idempotencyKey: string | null; method: string }[] = [];
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "goal-e2e-session" },
        snapshot: { ...taskSnapshot, goal },
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/goal", async (route) => {
    const request = route.request();
    requests.push({
      body: request.postDataJSON(),
      idempotencyKey: request.headers()["idempotency-key"] ?? null,
      method: request.method(),
    });
    await route.fulfill({
      contentType: "application/json",
      json:
        request.method() === "DELETE" ? { cleared: true } : { goal: { ...goal, status: "active" } },
    });
  });

  await page.goto("/p/codexly/t/task-1");

  const statusTag = page.locator('[data-goal-status="paused"]');
  await expect(statusTag).toContainText("目标已暂停");
  await expect(statusTag).toHaveAttribute("aria-label", /完成官方 Goal 生命周期对接/u);
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "上下文" }).click();
  const goalRegion = inspector.getByRole("region", { name: "目标" });
  await expect(goalRegion).toContainText("完成官方 Goal 生命周期对接");
  await expect(goalRegion).toContainText("4,096 / 20,000 tokens");
  await goalRegion.getByRole("button", { name: "恢复目标" }).click();
  await goalRegion.getByRole("button", { name: "清除目标" }).click();

  await expect.poll(() => requests.length).toBe(2);
  expect(requests).toMatchObject([
    { body: { status: "active" }, method: "PUT" },
    { body: {}, method: "DELETE" },
  ]);
  expect(requests.every(({ idempotencyKey }) => idempotencyKey !== null)).toBe(true);
});

test("builds a completed plan as a normal development turn", async ({ page }) => {
  let turnBody: unknown;
  const completedPlanSnapshot = {
    ...taskSnapshot,
    status: "idle" as const,
    turns: [
      {
        completedAt: "2026-08-05T06:00:30.000Z",
        error: null,
        id: "turn-plan",
        items: [
          {
            id: "plan-1",
            text: "# 实施计划\n\n- 调整计划卡片\n- 验证构建流程",
            type: "plan" as const,
          },
        ],
        startedAt: "2026-08-05T06:00:00.000Z",
        status: "completed" as const,
      },
    ],
  };
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: completedPlanSnapshot,
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-build-plan",
          items: [],
          startedAt: "2026-08-05T06:01:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/plan");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "取消计划模式" })).toBeVisible();
  await expect(page.locator('[data-ai-plan-card=""]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "实施计划" })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "构建" }).click();

  await expect(page.getByRole("button", { name: "取消计划模式" })).toHaveCount(0);
  await expect(page.getByText("请开始按照上述计划进行开发。", { exact: true })).toBeVisible();
  expect(turnBody).toEqual({
    input: {
      attachments: [],
      skills: [],
      text: "请开始按照上述计划进行开发。",
      type: "prompt",
    },
    options: taskSnapshot.settings,
  });
});

test("selects and submits a host file as an attachment", async ({ page }) => {
  let importRequest: { body: unknown; url: string } | undefined;
  let turnBody: unknown;
  await page.route("**/v1/projects/codexly/attachments/file/host", async (route) => {
    const request = route.request();
    importRequest = {
      body: request.postDataJSON(),
      url: request.url(),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-pdf",
          kind: "file",
          mediaType: "application/pdf",
          name: "specification.pdf",
          size: 8,
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-file-attachment",
          items: [],
          startedAt: "2026-08-02T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  await chooseHostAttachment(page, "file", "specification.pdf");
  await expect(page.getByText("specification.pdf", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "任务输入" }).fill("总结附件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect.poll(() => turnBody).not.toBeUndefined();

  expect(importRequest?.url).toMatch(/\/attachments\/file\/host$/u);
  expect(importRequest?.body).toEqual({ path: "/Users/bryan/Attachments/specification.pdf" });
  expect(turnBody).toMatchObject({
    input: {
      attachments: [{ id: "attachment-pdf" }],
      text: "总结附件",
      type: "prompt",
    },
  });
});
