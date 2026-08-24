import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
import { getTaskActivity } from "./task-activity.js";
import { createProjectRuntimeManager, ProjectEventHistory } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import {
  createTurn,
  createSnapshotResponse,
  createTurnCompletedEvent,
  createTurnStartedEvent,
  createMessageDeltaEvent,
  createFileChangeCompletedEvent,
  createClientHarness,
  createTaskNotifier,
} from "./project-runtime.test-support.js";

describe("project runtime replay", () => {
  it("replays Project events that arrived while a Task Snapshot was loading", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    harness.emit(createTurnStartedEvent("task-2", 1));
    const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });

    const detach = manager.attachTaskStore(
      createSnapshotResponse("task-2", { status: "idle" }),
      secondStore,
      vi.fn(),
    );

    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(secondStore.getState().snapshotMetadata?.status).toBe("running");
    expect(secondStore.getState().checkpoint?.sequence).toBe(1);
    detach();
    manager.dispose();
  });

  it("preserves retained turn items when a refreshed snapshot omits them", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const response = createSnapshotResponse("task-1", { sequence: 2, title: "刷新后的标题" });
    const currentResponse: AgentTaskSnapshotResponse = {
      ...response,
      snapshot: {
        ...response.snapshot,
        title: "旧标题",
        turns: [
          {
            ...createTurn("task-1"),
            items: [
              {
                id: "tool-read-file",
                input: { path: "package.json" },
                name: "read_file",
                output: { content: "Codexly" },
                status: "completed",
                type: "tool",
              },
            ],
          },
        ],
      },
    };
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, currentResponse);

    const detach = manager.attachTaskStore(response, store, vi.fn());

    expect(store.getState().getItem("tool-read-file", "turn-task-1")).toMatchObject({
      name: "read_file",
      status: "completed",
    });
    expect(store.getState().checkpoint).toEqual(response.checkpoint);
    expect(store.getState().snapshotMetadata?.title).toBe("刷新后的标题");
    detach();
    manager.dispose();
  });

  it("replays wrapped Project history without shifting the backing array", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, {
      maxEventHistoryEvents: 2,
      taskNotifier: createTaskNotifier(),
    });
    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    const retainedHistory = new ProjectEventHistory({
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxEvents: 2,
    });
    const retainedEvents: AgentEvent[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    try {
      const firstEvent = createTurnStartedEvent("task-1", 1);
      const secondEvent = createTurnStartedEvent("task-2", 2);
      const thirdEvent = createMessageDeltaEvent("task-2", 3, "环绕后继续输出");
      retainedHistory.append(firstEvent);
      retainedHistory.append(secondEvent);
      retainedHistory.append(thirdEvent);
      retainedHistory.forEachAfter(1, (event) => {
        retainedEvents.push(event);
      });
      harness.emit(firstEvent);
      harness.emit(secondEvent);
      harness.emit(thirdEvent);

      const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });
      const detach = manager.attachTaskStore(
        createSnapshotResponse("task-2", { sequence: 1, status: "idle" }),
        secondStore,
        vi.fn(),
      );

      expect(secondStore.getState().checkpoint?.sequence).toBe(3);
      expect(secondStore.getState().getItem("message-task-2", "turn-task-2")).toMatchObject({
        text: "环绕后继续输出",
      });
      expect(retainedHistory.floorSequence).toBe(1);
      expect(retainedEvents.map((event) => event.sequence)).toEqual([2, 3]);
      detach();
    } finally {
      manager.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("evicts the oldest Project event when the byte budget is exceeded", () => {
    const firstEvent = createTurnStartedEvent("task-1", 1);
    const secondEvent = createTurnStartedEvent("task-2", 2);
    const history = new ProjectEventHistory({
      maxBytes: Math.max(estimateRetainedBytes(firstEvent), estimateRetainedBytes(secondEvent)),
      maxEvents: 10,
    });
    const retainedSequences: number[] = [];

    history.append(firstEvent);
    history.append(secondEvent);
    history.forEachAfter(0, (event) => {
      retainedSequences.push(event.sequence);
    });

    expect(history.floorSequence).toBe(1);
    expect(retainedSequences).toEqual([2]);
  });

  it("refreshes stores that still belong to an earlier Project Session", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const firstStore = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const secondStore = createTaskStore({ projectId: "project-1", taskId: "task-2" });
    const recoverFirst = vi.fn();
    const recoverSecond = vi.fn();

    const detachFirst = manager.attachTaskStore(
      createSnapshotResponse("task-1"),
      firstStore,
      recoverFirst,
    );
    const detachSecond = manager.attachTaskStore(
      createSnapshotResponse("task-2", { sessionId: "runtime-2" }),
      secondStore,
      recoverSecond,
    );

    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(recoverFirst).toHaveBeenCalledTimes(1);
    expect(recoverSecond).not.toHaveBeenCalled();
    expect(firstStore.getState().connectionState).toBe("reconnecting");

    detachFirst();
    detachSecond();
    manager.dispose();
  });

  it("retries a failed Snapshot recovery before accepting later realtime events", async () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const recoveredSnapshot = createSnapshotResponse("task-1", { sequence: 8 });
    const recoverSnapshot = vi
      .fn<() => Promise<AgentTaskSnapshotResponse | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(recoveredSnapshot);
    const detach = manager.attachTaskStore(
      createSnapshotResponse("task-1"),
      store,
      recoverSnapshot,
    );

    harness.requireResync();
    await Promise.resolve();
    expect(recoverSnapshot).toHaveBeenCalledTimes(1);

    // Socket 提前连通不能绕过 Snapshot 校准，恢复成功前始终保持非阻塞恢复状态。
    harness.connectionState("connected");
    expect(store.getState().connectionState).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recoverSnapshot).toHaveBeenCalledTimes(2);
    harness.connectionState("connected");
    harness.emit(createFileChangeCompletedEvent("task-1", 9));

    expect(store.getState().connectionState).toBe("connected");
    expect(store.getState().getItem("file-change-task-1", "turn-task-1")).toBeDefined();
    expect(store.getState().checkpoint?.sequence).toBe(9);

    detach();
    manager.dispose();
  });

  it("retries Snapshot recovery without Task Store consumers and resumes Project events", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    harness.client.readTask
      .mockRejectedValueOnce(new Error("Snapshot recovery failed"))
      .mockResolvedValueOnce(createSnapshotResponse("task-1", { sequence: 8 }));
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    harness.requireResync();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.client.readTask).toHaveBeenCalledTimes(1);
    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Codexly internal warning", {
      diagnosticCode: "snapshot_recovery_failed",
      errorMessage: "Snapshot recovery failed",
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(harness.client.readTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.client.readTask).toHaveBeenCalledTimes(2);
    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(2);

    harness.emit(createTurnCompletedEvent("task-1", 9));
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1").isRunning).toBe(false);
    manager.dispose();
  });

  it("recovers every active background task with bounded concurrency after resync", async () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    const taskIds = Array.from({ length: 6 }, (_, index) => `task-${String(index + 1)}`);
    const pendingReads = new Map<string, (response: AgentTaskSnapshotResponse) => void>();
    let concurrentReads = 0;
    let maxConcurrentReads = 0;

    harness.client.readTask.mockImplementation(
      (_projectId, taskId) =>
        new Promise((resolve) => {
          concurrentReads += 1;
          maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
          pendingReads.set(taskId, (response) => {
            concurrentReads -= 1;
            resolve(response);
          });
        }),
    );
    for (const taskId of taskIds) {
      manager.observeSnapshot(createSnapshotResponse(taskId));
    }

    harness.requireResync();

    expect(harness.client.readTask).toHaveBeenCalledTimes(4);
    expect(maxConcurrentReads).toBe(4);
    for (const taskId of taskIds.slice(0, 4)) {
      pendingReads.get(taskId)?.(createSnapshotResponse(taskId, { sequence: 8, status: "idle" }));
    }
    await vi.waitFor(() => {
      expect(harness.client.readTask).toHaveBeenCalledTimes(6);
    });
    for (const taskId of taskIds.slice(4)) {
      pendingReads.get(taskId)?.(createSnapshotResponse(taskId, { sequence: 8, status: "idle" }));
    }
    await vi.waitFor(() => {
      for (const taskId of taskIds) {
        expect(getTaskActivity(manager.getTaskActivity(), "project-1", taskId).isRunning).toBe(
          false,
        );
      }
    });

    expect(maxConcurrentReads).toBe(4);
    manager.dispose();
  });
});
