import type { Locator, WebSocketRoute } from "@playwright/test";
import {
  taskSnapshotRoute,
  chooseHostAttachment,
  enableLanAccess,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  tasks,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

async function expectAbove(upper: Locator, lower: Locator) {
  const [upperBounds, lowerBounds] = await Promise.all([upper.boundingBox(), lower.boundingBox()]);
  if (upperBounds === null || lowerBounds === null) {
    throw new Error("Missing layout bounds");
  }
  expect(upperBounds.y + upperBounds.height).toBeLessThanOrEqual(lowerBounds.y);
}

async function expectStatusCentered(status: Locator, prompt: Locator) {
  const [first, last, input] = await Promise.all([
    status.locator("> :first-child").boundingBox(),
    status.locator("> :last-child").boundingBox(),
    prompt.locator("xpath=ancestor::form").boundingBox(),
  ]);
  if (first === null || last === null || input === null) {
    throw new Error("Missing generation status or composer bounds");
  }
  const statusCenter = (first.x + last.x + last.width) / 2;
  expect(Math.abs(statusCenter - (input.x + input.width / 2))).toBeLessThanOrEqual(1);
}

test("disables composer mutations that the provider does not support", async ({ page }) => {
  await page.route("**/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        feedback: { upload: false },
        goals: { clear: true, read: true, update: true },
        provider: "codex",
        skills: { list: false, use: false },
        tasks: { fork: false, list: true, read: true, start: false },
        turns: {
          compact: false,
          interrupt: false,
          review: false,
          start: false,
          steer: false,
        },
      },
    });
  });
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("不应允许提交");

  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
});

test("stores composer drafts independently between task routes", async ({ page }) => {
  await enableLanAccess(page);
  await page.route(taskSnapshotRoute("input-design"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
          goal: null,
          pendingRequests: [],
          settings: taskSnapshot.settings,
          status: "idle",
          turns: [],
          turnsNextCursor: null,
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("textbox", { name: "任务输入" }).fill("只属于 Task A 的草稿");
  await chooseHostAttachment(page, "image", "task-draft.png");
  await expect(page.getByText("task-draft.png", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /优化输入框交互/ }).click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/input-design$/);
  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveAttribute(
    "data-serialized-value",
    "",
  );
  await expect(page.getByText("task-draft.png", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();

  await page.locator('a[href="/p/codexly/t/task-1"]').first().click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/);
  await expect(page.getByRole("textbox", { name: "任务输入" })).toHaveAttribute(
    "data-serialized-value",
    "只属于 Task A 的草稿",
  );
  await expect(page.getByText("task-draft.png", { exact: true })).toBeVisible();
});

test("keeps the composer input mounted when switching task routes", async ({ page }) => {
  let markSnapshotRequested: () => void = () => undefined;
  const snapshotRequested = new Promise<void>((resolve) => {
    markSnapshotRequested = resolve;
  });
  let releaseSnapshot: () => void = () => undefined;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  await page.route(taskSnapshotRoute("input-design"), async (route) => {
    markSnapshotRequested();
    await snapshotGate;
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
          goal: null,
          pendingRequests: [],
          settings: taskSnapshot.settings,
          status: "idle",
          turns: [],
          turnsNextCursor: null,
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  const currentPrompt = page.getByRole("textbox", { name: "任务输入" });
  await currentPrompt.fill("只属于 Task A 的草稿");
  await currentPrompt.evaluate((editor) => {
    Reflect.set(globalThis, "__testComposerEditor", editor);
  });

  await page.getByRole("link", { name: /优化输入框交互/ }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/input-design$/);
  await snapshotRequested;

  const nextPrompt = page.getByRole("textbox", { name: "任务输入" });
  // 等待目标快照时暂时禁止写入，避免把上一任务的草稿提交到新任务。
  await expect(nextPrompt).toBeDisabled();
  await expect(nextPrompt).toHaveValue("");
  releaseSnapshot();
  await expect(nextPrompt).toBeEditable();
  await expect(nextPrompt).toHaveValue("");
  await expect
    .poll(() =>
      nextPrompt.evaluate((editor) => Reflect.get(globalThis, "__testComposerEditor") === editor),
    )
    .toBe(true);
  await nextPrompt.fill("只属于 Task B 的草稿");
  await expect(nextPrompt).toHaveValue("只属于 Task B 的草稿");
});

test("keeps the workbench shell mounted between a task and a new task route", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  const shell = page.locator('.workbench-shell[data-embedded="false"]');
  await shell.evaluate((element) => {
    element.setAttribute("data-e2e-mount-marker", "retained");
  });

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("button", { name: "在 Codexly 中新建任务" }).click();

  await expect(page).toHaveURL(/\/p\/codexly$/u);
  await expect(shell).toHaveAttribute("data-e2e-mount-marker", "retained");

  await page.locator('a[href="/p/codexly/t/task-1"]').first().click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/u);
  await expect(shell).toHaveAttribute("data-e2e-mount-marker", "retained");
});

test("scrolls the conversation area to the bottom whenever the active task changes", async ({
  page,
}) => {
  const longTurns = Array.from({ length: 24 }, (_, turnIndex) => ({
    completedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:30.000Z`,
    error: null,
    id: `long-turn-${String(turnIndex)}`,
    items: [
      {
        id: `long-user-${String(turnIndex)}`,
        role: "user",
        text: `长会话问题 ${String(turnIndex + 1)}`,
        type: "message",
      },
      {
        id: `long-assistant-${String(turnIndex)}`,
        role: "assistant",
        text: `长会话回复 ${String(turnIndex + 1)}：${"持续输出用于验证任务切换后的滚动位置。".repeat(8)}`,
        type: "message",
      },
    ],
    startedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:00.000Z`,
    status: "completed",
  }));
  await page.route(taskSnapshotRoute("task-1"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: longTurns },
      },
    });
  });
  await page.route(taskSnapshotRoute("input-design"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          ...tasks[1],
          turns: [taskSnapshot.turns[0]],
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  const conversation = page.getByRole("region", { name: "会话内容" });
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(800);
  const mountedTurns = conversation.locator('section[aria-label^="Turn "]');
  // 已加载回合保留真实 DOM，历史仍由服务端分页控制。
  await expect(mountedTurns).toHaveCount(longTurns.length);
  await expect(conversation.locator('section[aria-label="Turn 24"]')).toBeVisible();

  await conversation.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.getByRole("link", { name: /优化输入框交互/u }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/input-design$/u);
  await expect(conversation).toContainText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。");

  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector<HTMLElement>('[role="log"][aria-label="会话内容"]');
      if (!element?.textContent.includes("长会话问题 24")) {
        return;
      }
      observer.disconnect();

      // 模拟长 Timeline 分帧提交时浏览器先报告临时中部位置，随后消息布局继续增高。
      element.scrollTop = 120;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      const delayedMessageLayout = document.createElement("div");
      delayedMessageLayout.style.height = "800px";
      delayedMessageLayout.style.flexShrink = "0";
      element.firstElementChild?.append(delayedMessageLayout);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  await page.locator('a[href="/p/codexly/t/task-1"]').first().click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/u);

  // 新 Task 内容完成布局后，聊天区域必须位于最底部，不能继承短会话的 scrollTop。
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("scrolls direct user submissions to the bottom without scrolling queued messages", async ({
  page,
}) => {
  const longTurns = Array.from({ length: 24 }, (_, turnIndex) => ({
    completedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:30.000Z`,
    error: null,
    id: `submission-scroll-turn-${String(turnIndex)}`,
    items: [
      {
        id: `submission-scroll-user-${String(turnIndex)}`,
        role: "user",
        text: `滚动测试问题 ${String(turnIndex + 1)}`,
        type: "message",
      },
      {
        id: `submission-scroll-assistant-${String(turnIndex)}`,
        role: "assistant",
        text: `滚动测试回复 ${String(turnIndex + 1)}：${"保持足够内容以验证中栏滚动行为。".repeat(8)}`,
        type: "message",
      },
    ],
    startedAt: `2026-07-22T08:${String(turnIndex).padStart(2, "0")}:00.000Z`,
    status: "completed",
  }));
  await page.route(taskSnapshotRoute("task-1"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: longTurns },
      },
    });
  });
  await page.route("**/v1/projects/codexly/submissions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "direct-submission-turn",
          items: [],
          startedAt: "2026-08-03T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const conversation = page.getByRole("region", { name: "会话内容" });
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(800);
  // 使用真实滚轮表达阅读历史的意图，与官方 Scroller 的自动跟随契约一致。
  await conversation.hover();
  await page.mouse.wheel(0, -1500);

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("直接发送的新消息");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("button", { exact: true, name: "停止" })).toBeVisible();
  await expect(page.getByText("直接发送的新消息", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AI 回复正在运行")).toBeVisible();
  await expect(conversation.locator("[data-turn-processing-time]").last()).toBeVisible();
  await expect(conversation.locator("[data-turn-processing-time]").last()).not.toContainText("t/s");
  const generationStatus = page.locator("[data-turn-generation-status]");
  await expect(generationStatus).toContainText("生成中");
  await expect(generationStatus).toContainText("0 次工具调用");
  await expect(generationStatus).not.toContainText("t/s");
  await expectAbove(generationStatus, prompt);
  await expectStatusCentered(generationStatus, prompt);

  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(1);

  // 使用真实滚轮表达阅读历史的意图，与官方 Scroller 的自动跟随契约一致。
  await conversation.hover();
  await page.mouse.wheel(0, -1500);
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(100);
  await prompt.fill("运行中排队的消息");
  await page.getByRole("button", { exact: true, name: "排队消息" }).click();
  const queue = page.getByRole("list", { name: "排队消息" });
  await expect(queue).toContainText("运行中排队的消息");
  await expectAbove(generationStatus, queue);
  await expectAbove(queue, prompt);
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(100);
});

test("keeps generation status between a question card and the input at 390px @cross-browser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const startedAt = new Date().toISOString();
  const sockets: WebSocketRoute[] = [];
  const { sessionId, sequence } = taskSnapshotResponse.checkpoint;
  await page.routeWebSocket("**/v1/projects/codexly/events?*", (socket) => {
    sockets.push(socket);
    socket.send(
      JSON.stringify({ type: "connection.ready", version: 3, sessionId, latestSequence: sequence }),
    );
  });
  await page.route(taskSnapshotRoute("task-1"), async (route) => {
    await route.fulfill({
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              id: "turn-1",
              status: "running",
              startedAt,
              completedAt: null,
              error: null,
              items: [],
            },
          ],
          pendingRequests: [
            {
              createdAt: startedAt,
              expiresAt: null,
              itemId: "generation-question",
              projectId: "codexly",
              questions: [
                {
                  header: "执行模式",
                  id: "mode",
                  isOther: false,
                  isSecret: false,
                  options: [{ description: "继续实现", label: "继续" }],
                  prompt: "下一步怎么处理？",
                  type: "choice",
                },
              ],
              requestId: "string:generation-question",
              status: "pending",
              taskId: "task-1",
              turnId: "turn-1",
              type: "user_input",
            },
          ],
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  const status = page.locator("[data-turn-generation-status]");
  const question = page.locator('[data-slot="pending-request-dock"]');
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await expect(status).toBeVisible();
  await expect(status).not.toContainText("t/s");
  await expect(question).toContainText("下一步怎么处理？");
  await expectAbove(question, status);
  await expectAbove(status, prompt);
  await expectStatusCentered(status, prompt);
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  // 模拟 ACP 一次性送达的短回复，确认工作台无需继续收包即可刷新速度。
  const event = {
    version: 2,
    type: "message.delta",
    sequence: sequence + 1,
    sessionId,
    provider: "codex",
    taskId: "task-1",
    turnId: "turn-1",
    itemId: "single-chunk",
    timestamp: startedAt,
    payload: { delta: "已完成检查" },
  };
  for (const socket of sockets) {
    socket.send(JSON.stringify({ type: "events.batch", version: 3, events: [event] }));
  }
  await expect(status).toContainText("4.0 t/s");
  await expectAbove(question, status);
  await expectStatusCentered(status, prompt);
});
