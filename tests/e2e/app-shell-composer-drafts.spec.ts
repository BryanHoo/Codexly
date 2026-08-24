import {
  chooseHostAttachment,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  tasks,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("disables composer mutations that the provider does not support", async ({ page }) => {
  await page.route("**/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        feedback: { upload: false },
        provider: "readonly",
        skills: { list: false, use: false },
        tasks: { fork: false, list: true, read: true, start: false },
        turns: {
          compact: false,
          interrupt: false,
          review: false,
          start: false,
        },
      },
    });
  });
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("不应允许提交");

  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
});

test("stores composer drafts independently between task routes", async ({ page }) => {
  await page.route("**/v1/projects/codexly/tasks/input-design", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
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
  await page.route("**/v1/projects/codexly/tasks/input-design", async (route) => {
    markSnapshotRequested();
    await snapshotGate;
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...tasks[1],
          contextUsage: null,
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
  const inputStateWhileSnapshotLoads = await nextPrompt.evaluate((editor) => {
    if (!(editor instanceof HTMLDivElement) || editor.contentEditable !== "true") {
      throw new Error("任务输入不是可编辑区域");
    }
    const wasEmpty = editor.textContent === "";
    editor.focus();
    const acceptsFocus = document.activeElement === editor;
    editor.dispatchEvent(new CompositionEvent("compositionstart"));
    editor.textContent = "n";
    editor.dispatchEvent(new CompositionEvent("compositionupdate", { data: "n" }));
    return { acceptsFocus, wasEmpty };
  });
  releaseSnapshot();
  expect(inputStateWhileSnapshotLoads).toEqual({ acceptsFocus: true, wasEmpty: true });
  await expect(nextPrompt).toHaveText("n");
  await expect
    .poll(() =>
      nextPrompt.evaluate((editor) => Reflect.get(globalThis, "__testComposerEditor") === editor),
    )
    .toBe(true);
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
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: longTurns },
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/input-design", async (route) => {
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
  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(800);
  const mountedTurns = conversation.locator('section[aria-label^="Turn "]');
  await expect.poll(() => mountedTurns.count()).toBeLessThan(longTurns.length);
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
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: longTurns },
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
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

  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(800);
  await conversation.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("直接发送的新消息");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("button", { exact: true, name: "停止" })).toBeVisible();
  await expect(page.getByText("直接发送的新消息", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AI 回复正在运行")).toBeVisible();
  await expect(conversation.locator("[data-turn-processing-time]").last()).toBeVisible();
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(1);

  await conversation.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(100);
  await prompt.fill("运行中排队的消息");
  await page.getByRole("button", { exact: true, name: "排队消息" }).click();
  await expect(page.getByRole("list", { name: "排队消息" })).toContainText("运行中排队的消息");
  await expect
    .poll(() =>
      conversation.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(100);
});
