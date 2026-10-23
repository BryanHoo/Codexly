import * as notifications from "@codexly/frontend-core/task-notification-store";
import { afterEach, expect, test, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";

import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import type { SubscribeAgentEventsOptions } from "../../../platform/native-client-types.js";
import type { AgentTaskSnapshotResponse } from "../../../protocol/index.js";

afterEach(() => vi.restoreAllMocks());

test("聚焦任务时自动已读全部对应通知，其他项目与任务保持未读", () => {
  const store = notifications.createTaskNotificationStore();
  vi.spyOn(notifications, "getTaskNotificationStore").mockReturnValue(store);
  const task = {
    projectId: "project-1",
    taskId: "task-1",
    taskName: "当前任务",
    status: "completed" as const,
    requiresApproval: false,
  };
  store.recordActivities([
    task,
    { ...task, status: "failed" },
    { ...task, projectId: "project-2" },
    { ...task, taskId: "task-2" },
  ]);
  const runtime = createProjectRuntimeManager({} as NativeRuntimeClient);
  try {
    runtime.viewTask("project-1");
    expect(store.getSnapshot().every((item) => !item.read)).toBe(true);
    runtime.viewTask("project-1", "task-1");
    expect(
      store.getSnapshot().map(({ projectId, taskId, read }) => ({ projectId, taskId, read })),
    ).toEqual([
      { projectId: "project-1", taskId: "task-2", read: false },
      { projectId: "project-2", taskId: "task-1", read: false },
      { projectId: "project-1", taskId: "task-1", read: true },
      { projectId: "project-1", taskId: "task-1", read: true },
    ]);
  } finally {
    runtime.dispose();
  }
});

test.each([false, true])(
  "已聚焦任务的迟到活动快照自动已读，切走后新通知保留未读（聚焦发生在读取期间：%s）",
  (focusDuringRead) => {
    const store = notifications.createTaskNotificationStore();
    vi.spyOn(notifications, "getTaskNotificationStore").mockReturnValue(store);
    const runtime = createProjectRuntimeManager({} as NativeRuntimeClient);
    const task = {
      projectId: "project-1",
      taskId: "task-1",
      taskName: "当前任务",
      status: "completed" as const,
      requiresApproval: false,
    };
    try {
      runtime.reconcileTaskActivities([task], runtime.getTaskActivity());
      const baseline = runtime.getTaskActivity();
      runtime.viewTask("project-1", "task-1");
      store.recordActivities([task]);
      runtime.reconcileTaskActivities(
        [task],
        focusDuringRead ? baseline : runtime.getTaskActivity(),
      );
      expect(store.getSnapshot()[0]?.read).toBe(true);
      runtime.viewTask("project-1", "task-2");
      const next = { ...task, status: "failed" as const };
      store.recordActivities([next]);
      runtime.reconcileTaskActivities([next], runtime.getTaskActivity());
      expect(store.getSnapshot()[0]?.read).toBe(false);
    } finally {
      runtime.dispose();
    }
  },
);

test("聚焦中的任务实时通知自动已读，后台任务实时通知保持未读", () => {
  const store = notifications.createTaskNotificationStore();
  vi.spyOn(notifications, "getTaskNotificationStore").mockReturnValue(store);
  let onEvent: SubscribeAgentEventsOptions["onEvent"] = () => {
    throw new Error("尚未订阅");
  };
  const runtime = createProjectRuntimeManager({
    subscribeEvents: (options: SubscribeAgentEventsOptions) => {
      onEvent = options.onEvent;
      return () => undefined;
    },
  } as NativeRuntimeClient);
  // 仅建立项目事件链路，通知自动已读不依赖加载聊天历史。
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sessionId: "session-1", sequence: 0 },
    snapshot: {
      id: "task-1",
      projectId: "project-1",
      title: "当前任务",
      status: "running",
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      pinned: false,
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      turns: [],
      turnsNextCursor: null,
      updatedAt: "2026-10-23T00:00:00Z",
    },
  };
  const event = {
    provider: "codex" as const,
    taskId: "task-1",
    sessionId: "session-1",
    sequence: 1,
    version: 2 as const,
    timestamp: "2026-10-23T00:01:00Z",
    type: "provider.error" as const,
    turnId: "turn-1",
    payload: { code: "other" as const, message: "执行失败", willRetry: false },
  };
  try {
    runtime.observeSnapshot(response);
    runtime.viewTask("project-1", "task-1");
    onEvent(event);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.read).toBe(true);
    runtime.viewTask("project-1", "task-2");
    onEvent({
      ...event,
      sequence: 2,
      type: "pending_request.created",
      itemId: "item-1",
      payload: {
        request: {
          requestId: "request-1",
          type: "user_input",
          projectId: "project-1",
          taskId: "task-1",
          turnId: "turn-1",
          createdAt: event.timestamp,
          expiresAt: null,
          itemId: "item-1",
          status: "pending",
          questions: [
            {
              id: "question-1",
              header: "确认",
              prompt: "如何继续？",
              type: "short_text",
              isOther: false,
              isSecret: false,
              options: [],
            },
          ],
        },
      },
    });
    expect(store.getSnapshot()[0]?.read).toBe(false);
  } finally {
    runtime.dispose();
  }
});
