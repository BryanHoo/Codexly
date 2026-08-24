import { describe, expect, it, vi } from "vitest";
import { getTaskActivity } from "./task-activity.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import {
  createSnapshotResponse,
  createTurnCompletedEvent,
  createTurnStartedEvent,
  createMessageDeltaEvent,
  createFileChangeCompletedEvent,
  createMcpServerStatusUpdatedEvent,
  createProjectGitMetadataChangedEvent,
  createClientHarness,
  createTaskNotifier,
} from "./project-runtime.test-support.js";

describe("project runtime events", () => {
  it("retries a busy task unsubscribe until Codex accepts the release", async () => {
    vi.useFakeTimers();
    try {
      const harness = createClientHarness();
      harness.client.unsubscribeTask
        .mockResolvedValueOnce({ status: "busy", taskId: "task-1" })
        .mockResolvedValueOnce({ status: "unsubscribed", taskId: "task-1" });
      const manager = createProjectRuntimeManager(harness.client);
      manager.observeSnapshot(createSnapshotResponse("task-1"));

      harness.emit(createTurnCompletedEvent("task-1", 1));
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.client.unsubscribeTask).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.client.unsubscribeTask).toHaveBeenCalledTimes(2);
      expect(harness.client.unsubscribeTask).toHaveBeenLastCalledWith("project-1", "task-1");
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a busy unsubscribe retry when the task gains a new consumer", async () => {
    vi.useFakeTimers();
    try {
      const harness = createClientHarness();
      harness.client.unsubscribeTask.mockResolvedValue({ status: "busy", taskId: "task-1" });
      const manager = createProjectRuntimeManager(harness.client);
      const response = createSnapshotResponse("task-1");
      manager.observeSnapshot(response);

      harness.emit(createTurnCompletedEvent("task-1", 1));
      await vi.advanceTimersByTimeAsync(0);
      const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
      manager.attachTaskStore(response, store, vi.fn());

      await vi.advanceTimersByTimeAsync(30_000);
      expect(harness.client.unsubscribeTask).toHaveBeenCalledOnce();
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards permission requests and Project events to the task notifier once", async () => {
    const harness = createClientHarness();
    const taskNotifier = createTaskNotifier();
    const manager = createProjectRuntimeManager(harness.client, { taskNotifier });
    manager.observeSnapshot(createSnapshotResponse("task-1", { title: "初始任务名称" }));
    manager.rememberTaskTitles([{ id: "task-1", projectId: "project-1", title: "完善通知功能" }]);

    await manager.requestNotificationPermission();
    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(taskNotifier.requestPermission).toHaveBeenCalledOnce();
    expect(taskNotifier.notify).toHaveBeenCalledOnce();
    expect(taskNotifier.notify).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ taskId: "task-1", type: "turn.completed" }),
      "完善通知功能",
    );
    manager.dispose();
  });

  it("logs browser notification isolation failures without interrupting Project events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createClientHarness();
    const taskNotifier = createTaskNotifier();
    taskNotifier.requestPermission.mockRejectedValueOnce(new Error("permission API failed"));
    taskNotifier.notify.mockImplementationOnce(() => {
      throw new Error("notification constructor failed");
    });
    const manager = createProjectRuntimeManager(harness.client, { taskNotifier });
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    await manager.requestNotificationPermission();
    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "notification_permission_failed",
      errorMessage: "permission API failed",
    });
    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "task_notification_failed",
      errorMessage: "notification constructor failed",
      projectId: "project-1",
      taskId: "task-1",
    });
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "completed",
    );
    manager.dispose();
    warn.mockRestore();
  });

  it("logs realtime transport failures without publishing them as Task errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = manager.attachTaskStore(createSnapshotResponse("task-1"), store, vi.fn());

    harness.connectionError(new Error("socket failed"));

    expect(store.getState().error).toBeNull();
    expect(warn).toHaveBeenCalledWith("CodeAgent internal warning", {
      diagnosticCode: "event_connection_failed",
      errorMessage: "socket failed",
      projectId: "project-1",
    });
    detach();
    manager.dispose();
  });

  it("opens one Project connection and fans events out to Activity and matching Task stores", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const firstResponse = createSnapshotResponse("task-1");
    const secondResponse = createSnapshotResponse("task-2");
    const firstStore = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });

    const detachFirst = manager.attachTaskStore(firstResponse, firstStore, vi.fn());
    const detachSecond = manager.attachTaskStore(secondResponse, secondStore, vi.fn());

    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1")).toEqual({
      attention: "completed",
      isAwaitingApproval: false,
      isRunning: false,
    });
    expect(firstStore.getState().snapshotMetadata?.status).toBe("idle");
    expect(firstStore.getState().checkpoint?.sequence).toBe(1);
    expect(secondStore.getState().snapshotMetadata?.status).toBe("running");

    detachFirst();
    detachSecond();
    manager.dispose();
  });

  it("clears attention when a task is viewed and only records later background events", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.emit(createTurnCompletedEvent("task-1", 1));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "completed",
    );

    manager.viewTask("project-1", "task-1");
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBeNull();

    manager.viewTask("project-1", "task-2");
    harness.emit(createTurnStartedEvent("task-1", 2));
    harness.emit(createTurnCompletedEvent("task-1", 3));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "completed",
    );
    manager.dispose();
  });

  it("requests task metadata refresh when a background turn completes", () => {
    const harness = createClientHarness();
    const onTaskMetadataChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onTaskMetadataChanged });
    manager.observeSnapshot(createSnapshotResponse("task-1", { title: "新聊天" }));
    manager.viewTask("project-1", "task-2");

    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(onTaskMetadataChanged).toHaveBeenCalledOnce();
    expect(onTaskMetadataChanged).toHaveBeenCalledWith("project-1", "task-1", "turn_completed");
    manager.dispose();
  });

  it("applies native task state and project cache invalidation events", () => {
    const harness = createClientHarness();
    const onSkillsChanged = vi.fn();
    const onQueueChanged = vi.fn();
    const onTaskMetadataChanged = vi.fn();
    const onTaskRemoved = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, {
      onSkillsChanged,
      onQueueChanged,
      onTaskMetadataChanged,
      onTaskRemoved,
    });
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));

    const envelope = {
      provider: "codex",
      sessionId: "runtime-1",
      timestamp: "2026-07-28T00:00:01.000Z",
      version: 2,
    } as const;
    harness.emit({
      ...envelope,
      payload: { status: "running" },
      sequence: 1,
      taskId: "task-1",
      type: "task.status_updated",
    });
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").isRunning).toBe(true);
    harness.emit({
      ...envelope,
      payload: {},
      sequence: 2,
      taskId: "task-1",
      type: "task.metadata_changed",
    });
    harness.emit({
      ...envelope,
      payload: {},
      sequence: 3,
      taskId: "project-1",
      type: "skills.changed",
    });
    harness.emit({
      ...envelope,
      payload: {},
      sequence: 4,
      taskId: "task-1",
      type: "queue.changed",
    });
    harness.emit({
      ...envelope,
      payload: { reason: "deleted" },
      sequence: 5,
      taskId: "task-1",
      type: "task.removed",
    });

    expect(onTaskMetadataChanged).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "native_notification",
    );
    expect(onSkillsChanged).toHaveBeenCalledWith("project-1");
    expect(onQueueChanged).toHaveBeenCalledWith("project-1", "task-1");
    expect(onTaskRemoved).toHaveBeenCalledWith("project-1", "task-1");
    manager.dispose();
  });

  it("reports optimistic and realtime Project Git activity", () => {
    const harness = createClientHarness();
    const onProjectGitActivity = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onProjectGitActivity });
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    manager.markTaskRunning("project-1", "task-optimistic");
    harness.emit(createTurnStartedEvent("task-1", 1));
    harness.emit(createFileChangeCompletedEvent("task-1", 2));
    harness.emit(createTurnCompletedEvent("task-1", 3));

    expect(onProjectGitActivity.mock.calls).toEqual([
      ["project-1", "task-1", "turn_started"],
      ["project-1", "task-optimistic", "turn_started"],
      ["project-1", "task-1", "turn_started"],
      ["project-1", "task-1", "file_changed"],
      ["project-1", "task-1", "turn_completed"],
    ]);
    manager.dispose();
  });

  it("reports Project Git metadata changes without creating Task activity", () => {
    const harness = createClientHarness();
    const taskNotifier = createTaskNotifier();
    const onProjectGitMetadataChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, {
      onProjectGitMetadataChanged,
      taskNotifier,
    });
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    const activityBeforeEvent = manager.getTaskActivity();

    harness.emit(createProjectGitMetadataChangedEvent("/workspace/project-1", 1));

    expect(onProjectGitMetadataChanged).toHaveBeenCalledOnce();
    expect(onProjectGitMetadataChanged).toHaveBeenCalledWith("project-1", "/workspace/project-1");
    expect(manager.getTaskActivity()).toBe(activityBeforeEvent);
    expect(taskNotifier.notify).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("reports MCP status changes for only the event task", () => {
    const harness = createClientHarness();
    const onMcpServerStatusChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onMcpServerStatusChanged });
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.emit(createMcpServerStatusUpdatedEvent("task-1", 1));

    expect(onMcpServerStatusChanged).toHaveBeenCalledOnce();
    expect(onMcpServerStatusChanged).toHaveBeenCalledWith("project-1", "task-1");
    manager.dispose();
  });

  it("reports Project Git activity when a Snapshot changes running state", () => {
    const harness = createClientHarness();
    const onProjectGitActivity = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onProjectGitActivity });

    manager.observeSnapshot(createSnapshotResponse("task-1"));
    manager.observeSnapshot(createSnapshotResponse("task-1"));
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));

    expect(onProjectGitActivity.mock.calls).toEqual([
      ["project-1", "task-1", "turn_started"],
      ["project-1", "task-1", "turn_completed"],
    ]);
    manager.dispose();
  });

  it("requests one task metadata refresh when a background assistant reply starts", () => {
    const harness = createClientHarness();
    const onTaskMetadataChanged = vi.fn();
    const manager = createProjectRuntimeManager(harness.client, { onTaskMetadataChanged });
    manager.observeSnapshot(createSnapshotResponse("task-1", { title: "新聊天" }));
    manager.viewTask("project-1", "task-2");

    harness.emit(createMessageDeltaEvent("task-1", 1, "正在"));
    harness.emit(createMessageDeltaEvent("task-1", 2, "回复"));

    expect(onTaskMetadataChanged).toHaveBeenCalledOnce();
    expect(onTaskMetadataChanged).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "assistant_reply_started",
    );
    manager.dispose();
  });

  it("does not create attention for terminal events on the viewed task", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));
    manager.viewTask("project-1", "task-1");

    harness.emit(createTurnCompletedEvent("task-1", 1));

    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBeNull();
    manager.dispose();
  });

  it("records an interrupted background reply until the task is viewed", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.emit(createTurnCompletedEvent("task-1", 1, "interrupted"));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBe(
      "failed",
    );

    manager.viewTask("project-1", "task-1");
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").attention).toBeNull();
    manager.dispose();
  });
});
