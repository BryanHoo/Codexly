import { expect, taskSnapshot, taskSnapshotResponse, tasks, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("opens a completed file change diff while the turn is still running", async ({ page }) => {
  const liveChange = {
    diff: "@@ -1 +1 @@\n-export const live = false;\n+export const live = true;",
    kind: "update" as const,
    path: "src/live.ts",
  };
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              completedAt: null,
              error: null,
              id: "turn-live-file",
              items: [
                {
                  id: "message-live-file",
                  role: "user",
                  text: "更新实时文件",
                  type: "message",
                },
              ],
              startedAt: "2026-08-09T00:00:00.000Z",
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.addInitScript(() => {
    type FileChangeEventWindow = Window & {
      __emitFileChangeEvent?: (event: unknown) => void;
    };

    class FileChangeWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        (window as FileChangeEventWindow).__emitFileChangeEvent = (event) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ events: [event], type: "events.batch", version: 3 }),
            }),
          );
        };
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 0,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 3,
              }),
            }),
          );
        });
      }

      public close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: FileChangeWebSocket,
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as Window & { __emitFileChangeEvent?: (event: unknown) => void })
            .__emitFileChangeEvent,
      ),
    )
    .toBe("function");
  await page.evaluate((change) => {
    const emit = (window as Window & { __emitFileChangeEvent?: (event: unknown) => void })
      .__emitFileChangeEvent;
    if (emit === undefined) throw new Error("File change event emitter is unavailable");
    emit({
      itemId: "file-live",
      payload: {
        item: {
          changes: [change],
          id: "file-live",
          status: "completed",
          type: "file_change",
        },
      },
      provider: "codex",
      sequence: 1,
      sessionId: "e2e-session",
      taskId: "task-1",
      timestamp: "2026-08-09T00:00:01.000Z",
      turnId: "turn-live-file",
      type: "item.completed",
      version: 2,
    });
  }, liveChange);

  const fileButton = page.getByRole("button", {
    name: "已编辑 live.ts，新增 1 行，删除 1 行，打开 Diff",
  });
  await expect(fileButton).toBeVisible();
  await fileButton.click();

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const diffPanel = inspector.getByRole("region", { name: "src/live.ts" });
  await expect(diffPanel.locator(".file-diff-renderer")).toContainText("export const live = true;");
  await expect(page.getByRole("dialog", { name: "live.ts" })).toHaveCount(0);
});

test("updates a running background task title and preserves blocking status", async ({ page }) => {
  let backgroundSnapshotReadCount = 0;
  const approvalRequest = {
    availableDecisions: ["allow", "deny"],
    command: "pnpm check",
    createdAt: "2026-07-29T00:00:01.000Z",
    cwd: "/workspace/Codexly",
    expiresAt: null,
    itemId: "approval-input-design",
    networkAccess: null,
    projectId: "codexly",
    reason: null,
    requestId: "approval-input-design",
    status: "pending",
    taskId: "input-design",
    turnId: "turn-input-design",
    type: "command_approval",
  } as const;
  await page.route("**/v1/projects/codexly/tasks?*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const projectTasks = tasks
      .filter((task) => task.projectId === "codexly")
      .slice(0, 5)
      .map((task) => (task.id === "markdown" ? { ...task, title: "新聊天" } : task));
    await route.fulfill({
      contentType: "application/json",
      json: { data: projectTasks, nextCursor: "5" },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/markdown", async (route) => {
    backgroundSnapshotReadCount += 1;
    const hasFormalTitle = backgroundSnapshotReadCount > 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 2, sessionId: "e2e-session" },
        snapshot: {
          ...taskSnapshot,
          id: "markdown",
          pinned: false,
          status: "running",
          title: hasFormalTitle ? "后台任务正式标题" : "新聊天",
          turns: [
            {
              completedAt: null,
              error: null,
              id: "turn-markdown",
              items: [
                { id: "markdown-user", role: "user", text: "更新后台任务标题", type: "message" },
                ...(hasFormalTitle
                  ? [
                      {
                        id: "markdown-assistant",
                        role: "assistant" as const,
                        text: "正在回复",
                        type: "message" as const,
                      },
                    ]
                  : []),
              ],
              startedAt: "2026-07-29T00:00:00.000Z",
              status: "running",
            },
          ],
          updatedAt: "2026-07-29T00:00:01.000Z",
        },
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
          id: "input-design",
          pendingRequests: [approvalRequest],
          pinned: false,
          status: "running",
          title: "优化输入框交互",
          turns: [],
        },
      },
    });
  });
  await page.addInitScript(() => {
    type SidebarEventEmitterWindow = Window & {
      __emitSidebarTaskEvent?: (event: unknown) => void;
    };

    class ControlledWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        const connectionGeneration =
          Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0") + 1;
        sessionStorage.setItem("__sidebarEventConnectionGeneration", String(connectionGeneration));
        (window as SidebarEventEmitterWindow).__emitSidebarTaskEvent = (event) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ events: [event], type: "events.batch", version: 3 }),
            }),
          );
        };
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 0,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 3,
              }),
            }),
          );
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: ControlledWebSocket,
    });
  });

  await page.goto("/p/codexly/t/task-1");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const backgroundTask = sidebar.getByRole("link", { name: /优化输入框交互/ });
  const completedTask = sidebar.locator('a[href="/p/codexly/t/markdown"]');
  const failedTask = sidebar.getByRole("link", { name: /完善 Runtime 状态/ });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as Window & { __emitSidebarTaskEvent?: (value: unknown) => void })
            .__emitSidebarTaskEvent,
      ),
    )
    .toBe("function");
  const turn = {
    completedAt: null,
    error: null,
    id: "turn-input-design",
    items: [],
    startedAt: "2026-07-29T00:00:00.000Z",
    status: "running",
  };
  const emitTaskEvent = async (event: Record<string, unknown>) => {
    await page.evaluate((taskEvent) => {
      const emitter = (window as Window & { __emitSidebarTaskEvent?: (value: unknown) => void })
        .__emitSidebarTaskEvent;
      if (emitter === undefined) {
        throw new Error("Sidebar task event emitter is unavailable");
      }
      emitter(taskEvent);
    }, event);
  };

  await emitTaskEvent({
    payload: { turn },
    provider: "codex",
    sequence: 1,
    sessionId: "e2e-session",
    taskId: "input-design",
    timestamp: "2026-07-29T00:00:00.000Z",
    turnId: turn.id,
    type: "turn.started",
    version: 2,
  });
  await emitTaskEvent({
    itemId: "approval-input-design",
    payload: {
      request: approvalRequest,
    },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "input-design",
    timestamp: "2026-07-29T00:00:01.000Z",
    turnId: turn.id,
    type: "pending_request.created",
    version: 2,
  });

  await expect(backgroundTask.getByRole("status", { name: "任务等待审批" })).toBeVisible();
  await backgroundTask.click();
  // Task 行获得焦点时会为操作按钮让位；焦点离开后仍需保留黄色等待标识。
  await page.getByRole("log", { name: "会话内容" }).click({ position: { x: 12, y: 12 } });
  await expect(backgroundTask.getByRole("status", { name: "任务等待审批" })).toBeVisible();

  const previousConnectionGeneration = await page.evaluate(() =>
    Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
  );
  await page.goto("/p/codexly/t/task-1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
      ),
    )
    .toBeGreaterThan(previousConnectionGeneration);
  const completedTurn = {
    ...turn,
    id: "turn-markdown",
  };
  await emitTaskEvent({
    payload: { turn: completedTurn },
    provider: "codex",
    sequence: 1,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:00.000Z",
    turnId: completedTurn.id,
    type: "turn.started",
    version: 2,
  });
  const runningStatus = completedTask.getByRole("status", { name: "任务运行中" });
  await expect(runningStatus).toBeVisible();
  await expect(runningStatus).toHaveCSS("color", "rgb(8, 124, 240)");
  await emitTaskEvent({
    itemId: "markdown-assistant",
    payload: { delta: "正在回复" },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:01.000Z",
    turnId: completedTurn.id,
    type: "message.delta",
    version: 2,
  });

  // 不进入后台 Task，也必须在 AI 仍回复时读取 Snapshot 并替换“新聊天”。
  await expect.poll(() => backgroundSnapshotReadCount).toBe(1);
  await expect(completedTask).toContainText("更新后台任务标题");
  await expect(completedTask.getByRole("status", { name: "任务运行中" })).toBeVisible();
  await emitTaskEvent({
    payload: {
      turn: {
        ...completedTurn,
        completedAt: "2026-07-29T00:00:02.000Z",
        status: "completed",
      },
    },
    provider: "codex",
    sequence: 3,
    sessionId: "e2e-session",
    taskId: "markdown",
    timestamp: "2026-07-29T00:00:02.000Z",
    turnId: completedTurn.id,
    type: "turn.completed",
    version: 2,
  });

  const completedStatus = completedTask.getByRole("status", { name: "AI 回复已完成" });
  await expect(completedStatus).toBeVisible();
  await expect(completedStatus).toHaveCSS("color", "rgb(77, 124, 15)");
  await expect(completedTask).toContainText("后台任务正式标题");

  await completedTask.click();
  await expect(completedTask.getByRole("status", { name: "AI 回复已完成" })).toHaveCount(0);

  const completedConnectionGeneration = await page.evaluate(() =>
    Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
  );
  await page.goto("/p/codexly/t/task-1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(sessionStorage.getItem("__sidebarEventConnectionGeneration") ?? "0"),
      ),
    )
    .toBeGreaterThan(completedConnectionGeneration);
  const failedTurn = {
    ...turn,
    id: "turn-runtime",
  };
  await emitTaskEvent({
    payload: { turn: failedTurn },
    provider: "codex",
    sequence: 1,
    sessionId: "e2e-session",
    taskId: "runtime",
    timestamp: "2026-07-29T00:00:00.000Z",
    turnId: failedTurn.id,
    type: "turn.started",
    version: 2,
  });
  await expect(failedTask.getByRole("status", { name: "任务运行中" })).toBeVisible();

  // Provider 明确停止重试时，后台 Task 必须保留失败提醒直到用户进入。
  await emitTaskEvent({
    payload: { message: "模型服务不可用", willRetry: false },
    provider: "codex",
    sequence: 2,
    sessionId: "e2e-session",
    taskId: "runtime",
    timestamp: "2026-07-29T00:00:02.000Z",
    turnId: failedTurn.id,
    type: "provider.error",
    version: 2,
  });
  await expect(failedTask.getByRole("status", { name: "AI 回复未完成" })).toBeVisible();

  await failedTask.click();
  await expect(failedTask.getByRole("status", { name: "AI 回复未完成" })).toHaveCount(0);
});
