import type { AgentEvent, AgentTurn, PendingRequest } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createTaskNotificationStore } from "@codexly/frontend-core/task-notification-store";

import {
  createBrowserTaskNotifier,
  type BrowserNotificationApi,
  type BrowserNotificationHandle,
} from "./browser-task-notifier.js";

function createTurnCompletedEvent(
  status: Extract<AgentTurn["status"], "completed" | "failed" | "interrupted">,
): AgentEvent {
  return {
    payload: {
      turn: {
        completedAt: "2026-07-30T00:00:01.000Z",
        error: status === "failed" ? "模型服务不可用" : null,
        id: "turn-1",
        items: [],
        startedAt: "2026-07-30T00:00:00.000Z",
        status,
      },
    },
    provider: "codex",
    sequence: 2,
    sessionId: "runtime-1",
    taskId: "task-1",
    timestamp: "2026-07-30T00:00:01.000Z",
    turnId: "turn-1",
    type: "turn.completed",
    version: 2,
  };
}

function createProviderErrorEvent(willRetry: boolean): AgentEvent {
  return {
    payload: { message: "模型服务不可用", willRetry },
    provider: "codex",
    sequence: 1,
    sessionId: "runtime-1",
    taskId: "task-1",
    timestamp: "2026-07-30T00:00:00.500Z",
    turnId: "turn-1",
    type: "provider.error",
    version: 2,
  };
}

function createPendingRequestEvent(type: PendingRequest["type"]): AgentEvent {
  type CreatedPendingRequest = Extract<
    AgentEvent,
    { type: "pending_request.created" }
  >["payload"]["request"];
  const common = {
    createdAt: "2026-07-30T00:00:00.000Z",
    expiresAt: null,
    itemId: "item-request-1",
    projectId: "project / 1",
    requestId: "request-1",
    status: "pending" as const,
    taskId: "task / 1",
    turnId: "turn-1",
  };
  let request: CreatedPendingRequest;
  switch (type) {
    case "user_input":
      request = {
        ...common,
        questions: [
          {
            header: "运行方式",
            id: "mode",
            isOther: true,
            isSecret: false,
            options: [],
            prompt: "请选择运行方式",
            type: "short_text",
          },
        ],
        type,
      };
      break;
    case "command_approval":
      request = {
        ...common,
        availableDecisions: ["allow", "deny"],
        command: "pnpm check",
        cwd: "/workspace/Codexly",
        kind: "command",
        networkAccess: null,
        reason: null,
        type,
      };
      break;
    case "file_change_approval":
      request = {
        ...common,
        availableDecisions: ["allow", "deny"],
        grantRoot: "/workspace/Codexly",
        reason: null,
        type,
      };
      break;
    case "tool_approval":
      request = {
        ...common,
        type,
        toolName: "Read",
        input: {},
        reason: null,
        availableDecisions: ["allow", "deny"],
      };
      break;
    case "permissions_approval":
      request = {
        ...common,
        cwd: "/workspace/Codexly",
        environmentId: null,
        permissions: { fileSystem: null, network: { enabled: true } },
        reason: null,
        type,
      };
      break;
    case "mcp_elicitation":
      request = {
        ...common,
        fields: [],
        message: "确认 MCP 请求",
        mode: "form",
        serverName: "example",
        type,
      };
      break;
  }
  return {
    itemId: request.itemId,
    payload: { request },
    provider: "codex",
    sequence: 3,
    sessionId: "runtime-1",
    taskId: request.taskId,
    timestamp: "2026-07-30T00:00:02.000Z",
    turnId: request.turnId,
    type: "pending_request.created",
    version: 2,
  };
}

function createHarness(
  initialPermission: NotificationPermission = "granted",
  isPageForeground = false,
) {
  let permission = initialPermission;
  const clickListeners: (() => void)[] = [];
  const handle: BrowserNotificationHandle = {
    addClickListener(listener) {
      clickListeners.push(listener);
    },
    close: vi.fn(),
  };
  const api: BrowserNotificationApi = {
    getPermission: () => permission,
    requestPermission: vi.fn(() => {
      permission = "granted";
      return Promise.resolve(permission);
    }),
    show: vi.fn(() => handle),
  };
  const focusPage = vi.fn();
  const navigateToTask = vi.fn();
  return {
    api,
    click() {
      clickListeners.forEach((listener) => {
        listener();
      });
    },
    focusPage,
    handle,
    navigateToTask,
    notifier: createBrowserTaskNotifier({
      api,
      focusPage,
      isPageForeground: () => isPageForeground,
      navigateToTask,
    }),
  };
}

describe("browser task notifier", () => {
  it("逐 Token 事件不读取通知权限和本地偏好", () => {
    const harness = createHarness();
    const enabled = vi.fn(() => true);
    const permission = vi.spyOn(harness.api, "getPermission");
    const notifier = createBrowserTaskNotifier({
      api: harness.api,
      isEnabled: enabled,
      isPageForeground: () => false,
    });
    notifier.notify(
      "project",
      {
        version: 2,
        provider: "codex",
        sessionId: "runtime",
        sequence: 1,
        timestamp: "2026-10-27T00:00:00Z",
        taskId: "task",
        turnId: "turn",
        type: "message.delta",
        itemId: "message",
        payload: { delta: "文字" },
      },
      "任务",
    );
    expect(enabled).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
    notifier.dispose?.();
  });
  it("同一任务的新通知替换旧通知，标记已读后关闭系统提醒", () => {
    const harness = createHarness();
    const store = createTaskNotificationStore();
    const notifier = createBrowserTaskNotifier({
      api: harness.api,
      isPageForeground: () => false,
      notificationStore: store,
    });
    notifier.notify("project-1", createTurnCompletedEvent("completed"), "任务");
    notifier.notify("project-1", createTurnCompletedEvent("failed"), "任务");
    expect(harness.handle.close).toHaveBeenCalledOnce();
    store.recordActivities([
      {
        projectId: "project-1",
        taskId: "task-1",
        taskName: "任务",
        status: "failed",
        requiresApproval: false,
      },
    ]);
    store.markAllRead();
    expect(harness.handle.close).toHaveBeenCalledTimes(2);
    notifier.dispose?.();
  });

  it("关闭通知开关时立即回收已有通知，销毁后不再保留监听", () => {
    const harness = createHarness();
    const events = new EventTarget();
    let enabled = true;
    const notifier = createBrowserTaskNotifier({
      api: harness.api,
      isEnabled: () => enabled,
      isPageForeground: () => false,
      preferenceEvents: events,
    });
    notifier.notify("project-1", createTurnCompletedEvent("completed"), "任务");
    enabled = false;
    events.dispatchEvent(new Event("codexly:notification-preference-changed"));
    expect(harness.handle.close).toHaveBeenCalledOnce();
    notifier.dispose?.();
  });

  it("大量未关闭的任务通知只保留有界资源", () => {
    const harness = createHarness();
    for (let index = 0; index < 100; index++)
      harness.notifier.notify(
        "project",
        { ...createTurnCompletedEvent("completed"), taskId: String(index) },
        "任务",
      );
    expect(harness.handle.close).toHaveBeenCalledTimes(36);
    harness.notifier.dispose?.();
  });
  it("does not request permission or show notifications when notifications are disabled", async () => {
    const harness = createHarness("default");
    const notifier = createBrowserTaskNotifier({
      api: harness.api,
      isEnabled: () => false,
      isPageForeground: () => false,
    });

    await notifier.requestPermission();
    notifier.notify("project-1", createTurnCompletedEvent("completed"), "完善通知功能");

    expect(harness.api.requestPermission).not.toHaveBeenCalled();
    expect(harness.api.show).not.toHaveBeenCalled();
  });

  it.each([
    ["completed", "Task 已完成"],
    ["interrupted", "Task 已中断，无法继续"],
    ["failed", "Task 运行失败"],
  ] as const)("maps a %s terminal turn to a system notification", (status, body) => {
    const harness = createHarness();

    harness.notifier.notify("project-1", createTurnCompletedEvent(status), "完善通知功能");

    expect(harness.api.show).toHaveBeenCalledWith(
      "Codexly · 完善通知功能",
      expect.objectContaining({ body, tag: "project-1:task-1:turn-1:terminal" }),
    );
  });

  it.each([
    ["command_approval", "Task 等待审批"],
    ["file_change_approval", "Task 等待审批"],
    ["permissions_approval", "Task 等待审批"],
    ["mcp_elicitation", "Task 等待审批"],
    ["user_input", "Task 等待输入"],
  ] as const)("maps a %s request to an actionable notification", (type, body) => {
    const harness = createHarness();

    harness.notifier.notify("project / 1", createPendingRequestEvent(type), "实现审批流程");

    expect(harness.api.show).toHaveBeenCalledWith(
      "Codexly · 实现审批流程",
      expect.objectContaining({ body, tag: "project / 1:task / 1:request-1:request" }),
    );
    harness.click();
    expect(harness.focusPage).toHaveBeenCalledOnce();
    expect(harness.navigateToTask).toHaveBeenCalledWith("project / 1", "task / 1");
    expect(harness.handle.close).toHaveBeenCalledOnce();
  });

  it("requests permission only from the default state and stays inert before it is granted", async () => {
    const harness = createHarness("default");

    harness.notifier.notify("project-1", createTurnCompletedEvent("completed"), "完善通知功能");
    expect(harness.api.show).not.toHaveBeenCalled();

    await harness.notifier.requestPermission();
    await harness.notifier.requestPermission();
    harness.notifier.notify("project-1", createTurnCompletedEvent("completed"), "完善通知功能");

    expect(harness.api.requestPermission).toHaveBeenCalledOnce();
    expect(harness.api.show).toHaveBeenCalledOnce();
  });

  it("ignores retrying errors and avoids a duplicate failed notification at turn completion", () => {
    const harness = createHarness();

    harness.notifier.notify("project-1", createProviderErrorEvent(true), "完善通知功能");
    harness.notifier.notify("project-1", createProviderErrorEvent(false), "完善通知功能");
    harness.notifier.notify("project-1", createProviderErrorEvent(false), "完善通知功能");
    harness.notifier.notify("project-1", createTurnCompletedEvent("failed"), "完善通知功能");

    expect(harness.api.show).toHaveBeenCalledOnce();
    expect(harness.api.show).toHaveBeenCalledWith(
      "Codexly · 完善通知功能",
      expect.objectContaining({ body: "Task 运行失败：模型服务不可用" }),
    );
  });

  it("silently degrades when the browser notification API is unavailable", async () => {
    const notifier = createBrowserTaskNotifier({
      api: undefined,
      focusPage: vi.fn(),
      navigateToTask: vi.fn(),
    });

    await expect(notifier.requestPermission()).resolves.toBeUndefined();
    expect(() => {
      notifier.notify("project-1", createTurnCompletedEvent("completed"), "完善通知功能");
    }).not.toThrow();
  });

  it("does not send a system notification while the page is visible and focused", () => {
    const harness = createHarness("granted", true);

    harness.notifier.notify("project-1", createTurnCompletedEvent("completed"), "完善通知功能");

    expect(harness.api.show).not.toHaveBeenCalled();
  });

  it("does not interrupt a task action when the permission request throws synchronously", async () => {
    const harness = createHarness("default");
    vi.mocked(harness.api.requestPermission).mockImplementation(() => {
      throw new Error("Notification permission is unavailable");
    });

    await expect(harness.notifier.requestPermission()).resolves.toBeUndefined();
  });
});

it("异步问题发送一次待回答系统通知并支持点击导航", () => {
  const harness = createHarness("granted");
  const event: AgentEvent = {
    ...createTurnCompletedEvent("completed"),
    type: "item.completed",
    turnId: "turn-1",
    itemId: "question-1",
    payload: {
      item: {
        id: "question-1",
        type: "message",
        role: "assistant",
        text: "请选择",
        questions: [{ title: "运行方式", options: [] }],
      },
    },
  };
  harness.notifier.notify("project-1", event, "异步任务");
  harness.notifier.notify("project-1", event, "异步任务");
  expect(harness.api.show).toHaveBeenCalledOnce();
  expect(harness.api.show).toHaveBeenCalledWith(
    "Codexly · 异步任务",
    expect.objectContaining({ body: "Task 有待回答的问题，请处理" }),
  );
  harness.click();
  expect(harness.navigateToTask).toHaveBeenCalledWith("project-1", "task-1");
});
