import { afterEach, expect, it, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import {
  createClientHarness,
  createMessageDeltaEvent,
  createSnapshotResponse,
  createTurnCompletedEvent,
  createTurnStartedEvent,
} from "./project-runtime.test-support.js";

afterEach(() => vi.unstubAllGlobals());

it("切回保留任务时立即补齐后台消息和运行态，不等待快照或重建历史正文", () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const harness = createClientHarness();
  const manager = createProjectRuntimeManager(harness.client);
  const response = createSnapshotResponse("task-1", { status: "idle" });
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
  const recover = vi.fn();
  const detach = manager.attachTaskStore(response, store, recover);
  detach();
  harness.connectionState("connected");
  harness.emit(createTurnStartedEvent("task-1", 1));
  harness.emit(createMessageDeltaEvent("task-1", 2, "后台的新内容"));
  const reconstruct = vi.spyOn(store.getState(), "reconstructSnapshot");
  const reconcile = vi.spyOn(store.getState(), "reconcile");

  const release = manager.resumeTaskStore(store, recover);
  try {
    expect(release).toBeTypeOf("function");
    expect(store.getState().getItem("message-task-1", "turn-task-1")).toMatchObject({
      text: "后台的新内容",
    });
    expect(store.getState().snapshotMetadata?.status).toBe("running");
    expect(store.getState().checkpoint?.sequence).toBe(2);
    expect(reconstruct).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(harness.client.readTask).not.toHaveBeenCalled();
    expect(harness.client.subscribeEvents).toHaveBeenCalledTimes(1);
    harness.emit(createTurnCompletedEvent("task-1", 3));
    expect(store.getState().snapshotMetadata?.status).toBe("idle");
  } finally {
    release?.();
    manager.dispose();
  }
});

it.each(["cold", "gap", "session", "reconnecting", "closed"] as const)(
  "恢复边界不可靠时保留权威快照路径（%s）",
  (boundary) => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { maxEventHistoryEvents: 1 });
    const response = createSnapshotResponse("task-1");
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const recover = vi.fn();
    const detach = manager.attachTaskStore(response, store, recover);
    detach();
    harness.connectionState("connected");
    if (boundary === "gap") {
      harness.emit(createMessageDeltaEvent("task-1", 1, "已淘汰"));
      harness.emit(createMessageDeltaEvent("task-1", 2, "保留"));
    } else if (boundary === "session") {
      manager.observeSnapshot(createSnapshotResponse("task-2", { sessionId: "runtime-2" }));
    } else if (boundary === "reconnecting" || boundary === "closed") {
      harness.connectionState(boundary);
    }
    const target =
      boundary === "cold" ? createTaskStore({ projectId: "project-1", taskId: "task-1" }) : store;
    const before = target.getState();
    try {
      expect(manager.resumeTaskStore(target, recover)).toBeUndefined();
      expect(target.getState()).toBe(before);
    } finally {
      manager.dispose();
    }
  },
);
