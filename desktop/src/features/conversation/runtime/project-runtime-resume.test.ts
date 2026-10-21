import { afterEach, expect, it, vi } from "vitest";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import type { SubscribeAgentEventsOptions } from "@/platform/native-client-types.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";

function createSnapshotResponse(taskId: string, options: { status?: "idle" | "running"; sessionId?: string } = {}): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 0, sessionId: options.sessionId ?? "runtime-1" },
    snapshot: {
      id: taskId, projectId: "project-1", title: taskId, pinned: false,
      updatedAt: "2026-10-21T00:00:00.000Z", contextUsage: null, goal: null, plan: null,
      pendingRequests: [], status: options.status ?? "running", turns: [], turnsNextCursor: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" },
    },
  };
}

function createClientHarness() {
  let subscription!: SubscribeAgentEventsOptions;
  const client = {
    readTask: vi.fn(async () => createSnapshotResponse("task-1")),
    retainTaskSubscription: vi.fn(async () => undefined),
    releaseTaskSubscription: vi.fn(async () => undefined),
    subscribeEvents: vi.fn((options: SubscribeAgentEventsOptions) => {
      subscription = options;
      return vi.fn();
    }),
  };
  return {
    client,
    emit: (event: AgentEvent) => subscription.onEvent(event),
    connectionState: (state: "connected" | "reconnecting" | "closed") => subscription.onConnectionState?.(state),
  };
}

function createTurnStartedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    version: 2, provider: "codex", sessionId: "runtime-1", sequence, taskId,
    timestamp: "2026-10-21T00:00:00.000Z", turnId: `turn-${taskId}`, type: "turn.started",
    payload: { turn: { id: `turn-${taskId}`, status: "running", startedAt: "2026-10-21T00:00:00.000Z", completedAt: null, error: null, items: [] } },
  };
}
function createTurnCompletedEvent(taskId: string, sequence: number): AgentEvent {
  const event = createTurnStartedEvent(taskId, sequence);
  if (event.type !== "turn.started") throw new Error("样本必须是开始事件");
  return { ...event, type: "turn.completed", payload: { turn: { ...event.payload.turn, status: "completed", completedAt: "2026-10-21T00:00:01.000Z" } } };
}
function createMessageDeltaEvent(taskId: string, sequence: number, delta: string): AgentEvent {
  return { ...createTurnStartedEvent(taskId, sequence), type: "message.delta", itemId: `message-${taskId}`, payload: { delta } } as AgentEvent;
}

afterEach(() => vi.unstubAllGlobals());

it("切回保留任务时立即补齐后台消息和运行态，不等待快照或重建历史正文", () => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
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
    const target = boundary === "cold"
      ? createTaskStore({ projectId: "project-1", taskId: "task-1" })
      : store;
    const before = target.getState();
    try {
      expect(manager.resumeTaskStore(target, recover)).toBeUndefined();
      expect(target.getState()).toBe(before);
    } finally {
      manager.dispose();
    }
  },
);
