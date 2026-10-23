import * as notifications from "@codexly/frontend-core/task-notification-store";
import { afterEach, expect, test, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";

import {
  createClientHarness,
  createSnapshotResponse,
  createTurnCompletedEvent,
} from "./project-runtime.test-support.js";

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
  const runtime = createProjectRuntimeManager(createClientHarness().client);
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
    const runtime = createProjectRuntimeManager(createClientHarness().client);
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
  const harness = createClientHarness();
  const runtime = createProjectRuntimeManager(harness.client);
  try {
    runtime.observeSnapshot(createSnapshotResponse("task-1"));
    runtime.viewTask("project-1", "task-1");
    harness.emit(createTurnCompletedEvent("task-1", 1));
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.read).toBe(true);
    runtime.viewTask("project-1", "task-2");
    harness.emit(createTurnCompletedEvent("task-1", 2, "failed"));
    expect(store.getSnapshot()[0]?.read).toBe(false);
  } finally {
    runtime.dispose();
  }
});
