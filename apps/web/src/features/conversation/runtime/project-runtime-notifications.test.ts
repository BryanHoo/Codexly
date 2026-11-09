import {
  subscribeTaskNotificationsRead,
  type ReadTask,
} from "@codexly/frontend-core/task-notification-read";
import { expect, test, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";
import {
  createSnapshotResponse,
  createTurnCompletedEvent,
  createClientHarness,
} from "./project-runtime.test-support.js";

test("查看任务只回收对应系统通知，分屏隐藏后新活动不确认", () => {
  const read = vi.fn<(tasks: readonly ReadTask[]) => void>();
  const stop = subscribeTaskNotificationsRead(read);
  const runtime = createProjectRuntimeManager(createClientHarness().client);
  const task = {
    projectId: "project-1",
    taskId: "left",
    taskName: "分屏任务",
    status: "completed" as const,
    requiresApproval: false,
  };
  try {
    runtime.viewTask("project-1");
    expect(read).not.toHaveBeenCalled();
    const closeLeft = runtime.observeVisibleTask("project-1", "left");
    const closeRight = runtime.observeVisibleTask("project-1", "right");
    read.mockClear();
    runtime.reconcileTaskActivities(
      [task, { ...task, taskId: "right" }, { ...task, taskId: "background" }],
      runtime.getTaskActivity(),
    );
    const ids = read.mock.calls.flatMap(([tasks]) =>
      tasks.map((entry: { taskId: string }) => entry.taskId),
    );
    expect(ids).toContain("left");
    expect(ids).toContain("right");
    expect(ids).not.toContain("background");
    expect(runtime.getTaskActivity().get("project-1\u0000left")?.attention).toBeNull();
    closeLeft();
    closeRight();
    read.mockClear();
    runtime.reconcileTaskActivities(
      [{ ...task, taskId: "right", status: "failed" }],
      runtime.getTaskActivity(),
    );
    expect(read).not.toHaveBeenCalled();
    expect(runtime.getTaskActivity().get("project-1\u0000right")?.attention).toBe("failed");
  } finally {
    runtime.dispose();
    stop();
  }
});

test.each([false, true])(
  "迟到活动在前台确认，后台恢复前台时回收系统通知（读取中聚焦：%s）",
  (focusDuringRead) => {
    const target = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    vi.stubGlobal("document", target);
    vi.stubGlobal("window", new EventTarget());
    const read = vi.fn<(tasks: readonly ReadTask[]) => void>();
    const stop = subscribeTaskNotificationsRead(read);
    const runtime = createProjectRuntimeManager(createClientHarness().client);
    const task = {
      projectId: "project-1",
      taskId: "task-1",
      taskName: "当前任务",
      status: "completed" as const,
      requiresApproval: false,
    };
    try {
      const baseline = runtime.getTaskActivity();
      runtime.observeVisibleTask(task.projectId, task.taskId);
      runtime.viewTask(task.projectId, task.taskId);
      runtime.reconcileTaskActivities([task], runtime.getTaskActivity());
      expect(read).not.toHaveBeenCalled();
      target.visibilityState = "visible";
      target.dispatchEvent(new Event("visibilitychange"));
      expect(read).toHaveBeenCalledWith([{ projectId: task.projectId, taskId: task.taskId }]);
      read.mockClear();
      runtime.reconcileTaskActivities(
        [{ ...task, status: "failed" }],
        focusDuringRead ? baseline : runtime.getTaskActivity(),
      );
      expect(read).toHaveBeenCalled();
      expect(runtime.getTaskActivity().get("project-1\u0000task-1")?.attention).toBeNull();
    } finally {
      runtime.dispose();
      stop();
      vi.unstubAllGlobals();
    }
  },
);

test("实时终态回收可见任务的系统通知，后台任务保留提醒", () => {
  const read = vi.fn<(tasks: readonly ReadTask[]) => void>();
  const stop = subscribeTaskNotificationsRead(read);
  const harness = createClientHarness();
  const runtime = createProjectRuntimeManager(harness.client);
  try {
    runtime.observeSnapshot(createSnapshotResponse("task-1"));
    runtime.viewTask("project-1", "task-1");
    read.mockClear();
    harness.emit(createTurnCompletedEvent("task-1", 1));
    expect(read).toHaveBeenCalledWith([{ projectId: "project-1", taskId: "task-1" }]);
    runtime.viewTask("project-1", "task-2");
    read.mockClear();
    harness.emit(createTurnCompletedEvent("task-1", 2, "failed"));
    expect(read).not.toHaveBeenCalled();
  } finally {
    runtime.dispose();
    stop();
  }
});
