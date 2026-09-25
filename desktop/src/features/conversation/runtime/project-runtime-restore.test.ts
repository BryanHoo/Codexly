import type { SubscribeAgentEventsOptions } from "@/platform/native-client-types.js";
import type { AgentEvent, AgentTaskSnapshotResponse, TaskActivitySnapshot } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";

import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { createTaskStore } from "./task-store.js";
import { NativeCommandError } from "../../../platform/tauri/native-client.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSnapshot(projectId: string, taskId: string): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 4, sessionId: "session-1" },
    snapshot: {
      contextUsage: null,
      goal: null,
      id: taskId,
      pendingRequests: [],
      pinned: false,
      plan: null,
      projectId,
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "running",
      title: taskId,
      turns: [],
      turnsNextCursor: null,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  };
}

describe("ProjectRuntimeManager task activity restoration", () => {
  it.each(["recover", "recover-last", "external", "exhaust", "detach", "dispose"] as const)("bounds cold ownership retries and respects task lifetime (%s)", async (outcome) => {
    vi.useFakeTimers();
    const response = createSnapshot("project-1", "task-1");
    const failure = new NativeCommandError("CODEX_REQUEST_FAILED", "failed to read thread: thread-store internal error: failed to read session metadata from path: rollout at path is empty");
    const retainTaskSubscription = vi.fn().mockRejectedValue(failure);
    if (outcome === "recover") retainTaskSubscription.mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    if (outcome === "recover-last") retainTaskSubscription.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    if (outcome === "external") retainTaskSubscription.mockRejectedValue(new NativeCommandError("CODEX_THREAD_BUSY", "busy"));
    const client: NativeRuntimeClient = {
      readTask: vi.fn(async () => response), retainTaskSubscription,
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(() => () => undefined),
    };
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const observedErrors: Error[] = [];
    const unsubscribe = store.subscribe((state) => { if (state.error !== null) observedErrors.push(state.error); });
    const detach = runtime.attachTaskStore(response, store, async () => response);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().writeAccess).toBe(outcome === "external" ? "external" : "checking");
      expect(store.getState().error).toBeNull();
      if (outcome === "detach") detach();
      if (outcome === "dispose") runtime.dispose();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(store.getState().error).toBeNull();
      expect(store.getState().writeAccess).toBe(outcome === "recover" ? "writable" : outcome === "external" ? "external" : "checking");
      expect(retainTaskSubscription).toHaveBeenCalledTimes(outcome === "recover" || outcome === "recover-last" || outcome === "exhaust" ? 2 : 1);
      await vi.advanceTimersByTimeAsync(1);
      const expectedCalls = outcome === "recover" ? 2 : outcome === "exhaust" || outcome === "recover-last" ? 3 : 1;
      const recovered = outcome === "recover" || outcome === "recover-last";
      expect(retainTaskSubscription).toHaveBeenCalledTimes(expectedCalls);
      expect(store.getState().writeAccess).toBe(recovered ? "writable" : outcome === "external" ? "external" : outcome === "exhaust" ? "unavailable" : "checking");
      expect(store.getState().error).toBe(outcome === "exhaust" ? failure : null);
      expect(observedErrors.length > 0).toBe(outcome === "exhaust");
      expect(observedErrors.every((error) => error === failure)).toBe(true);
      expect(client.readTask).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(retainTaskSubscription).toHaveBeenCalledTimes(expectedCalls);
    } finally { unsubscribe(); detach(); runtime.dispose(); vi.useRealTimers(); }
  });

  it("does not let a pending retry clear a newer external lock and releases on detach", async () => {
    vi.useFakeTimers();
    const retry = deferred();
    const response = createSnapshot("project-1", "task-1");
    const client: NativeRuntimeClient = {
      readTask: vi.fn(async () => response),
      retainTaskSubscription: vi.fn().mockRejectedValueOnce(new Error("cold start")).mockReturnValue(retry.promise),
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(() => () => undefined),
    };
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = runtime.attachTaskStore(response, store, async () => response);
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(client.retainTaskSubscription).toHaveBeenCalledTimes(2);
      store.getState().setWriteAccess("external");
      retry.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().writeAccess).toBe("external");
      detach();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.releaseTaskSubscription).toHaveBeenCalledTimes(1);
    } finally { detach(); runtime.dispose(); vi.useRealTimers(); }
  });

  it.each(["success", "failure"] as const)("settles a cold ownership check after streaming has started (%s)", async (outcome) => {
    vi.useFakeTimers();
    const check = deferred();
    const response = createSnapshot("project-1", "task-1");
    let onEvent: SubscribeAgentEventsOptions["onEvent"] = () => undefined;
    const client: NativeRuntimeClient = {
      readTask: vi.fn(async () => response),
      retainTaskSubscription: vi.fn().mockReturnValueOnce(check.promise).mockResolvedValue(undefined),
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn((options) => {
        onEvent = options.onEvent;
        options.onConnectionState("connected");
        return () => undefined;
      }),
    };
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    let detach = runtime.attachTaskStore(response, store, async () => response);
    try {
      onEvent({
        version: 2, provider: "codex", sessionId: "session-1", sequence: 5,
        taskId: "task-1", turnId: "turn-1", timestamp: response.snapshot.updatedAt,
        type: "turn.started", payload: { turn: {
          id: "turn-1", status: "running", items: [], error: null,
          startedAt: response.snapshot.updatedAt, completedAt: null,
        } },
      });
      expect(store.getState().turnsById["turn-1"]?.status).toBe("running");
      expect(store.getState().writeAccess).toBe("checking");
      if (outcome === "success") check.resolve();
      else check.reject(new NativeCommandError("CODEX_REQUEST_FAILED", "cold resume failed"));
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().writeAccess).toBe(outcome === "success" ? "writable" : "checking");
      expect(store.getState().error).toBeNull();
      // 连接成功和后续增量均不能替代权威写入权检查。
      onEvent({
        version: 2, provider: "codex", sessionId: "session-1", sequence: 6,
        taskId: "task-1", turnId: "turn-1", itemId: "answer", timestamp: response.snapshot.updatedAt,
        type: "item.started", payload: { item: { id: "answer", type: "message", role: "assistant", text: "still streaming" } },
      });
      expect(store.getState().connectionState).toBe("connected");
      expect(store.getState().writeAccess).toBe(outcome === "success" ? "writable" : "checking");
      expect(client.retainTaskSubscription).toHaveBeenCalledTimes(1);
      detach();
      detach = runtime.attachTaskStore(response, store, async () => response);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().writeAccess).toBe("writable");
      expect(client.retainTaskSubscription).toHaveBeenCalledTimes(2);
    } finally { detach(); runtime.dispose(); vi.useRealTimers(); }
  });

  it("ignores a late ownership failure and releases only after the pending resume settles", async () => {
    const first = deferred();
    const second = deferred();
    const response = createSnapshot("project-1", "task-1");
    const client: NativeRuntimeClient = {
      readTask: vi.fn(async () => response),
      retainTaskSubscription: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(() => () => undefined),
    };
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = runtime.attachTaskStore(response, store, async () => response);
    detach();
    expect(client.releaseTaskSubscription).not.toHaveBeenCalled();
    const detachAgain = runtime.attachTaskStore(response, store, async () => response);
    second.resolve();
    await vi.waitFor(() => expect(store.getState().writeAccess).toBe("writable"));
    first.reject(new NativeCommandError("CODEX_THREAD_BUSY", "busy"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    expect(store.getState().writeAccess).toBe("writable");
    expect(client.releaseTaskSubscription).not.toHaveBeenCalled();
    detachAgain();
    await vi.waitFor(() => expect(client.releaseTaskSubscription).toHaveBeenCalledExactlyOnceWith("project-1", "task-1"));
    runtime.dispose();
  });

  it("keeps an externally owned task locked across snapshots and checks again on reopen", async () => {
    const retainTaskSubscription = vi.fn()
      .mockRejectedValueOnce(new NativeCommandError("CODEX_THREAD_BUSY", "busy"))
      .mockResolvedValue(undefined);
    const response = createSnapshot("project-1", "task-1");
    const client = {
      readTask: vi.fn(async () => response), retainTaskSubscription,
      releaseTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(() => () => undefined),
    } as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const detach = runtime.attachTaskStore(response, store, client.readTask.bind(client, "project-1", "task-1"));
    try {
      await vi.waitFor(() => expect(store.getState().writeAccess).toBe("external"));
      store.getState().hydrate(response);
      expect(store.getState().writeAccess).toBe("external");
      expect(retainTaskSubscription).toHaveBeenCalledExactlyOnceWith("project-1", "task-1");
      detach();
      const detachAgain = runtime.attachTaskStore(response, store, async () => response);
      await vi.waitFor(() => expect(store.getState().writeAccess).toBe("writable"));
      detachAgain();
    } finally { detach(); runtime.dispose(); }
  });

  it("reconnects after synchronous replay reports an evicted event", async () => {
    const cleanup = vi.fn();
    const subscribeEvents = vi.fn((options: SubscribeAgentEventsOptions) => {
      if (options.afterSequence === 4) {
        options.onResyncRequired({
          latestSequence: 5,
          reason: "event_retention_exceeded",
          sessionId: "session-1",
          type: "resync.required",
          version: 3,
        });
      }
      return cleanup;
    });
    const client = {
      readTask: vi.fn(async () => ({
        ...createSnapshot("project-1", "task-1"),
        checkpoint: { sequence: 5, sessionId: "session-1" },
      })),
      subscribeEvents,
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    try {
      runtime.observeSnapshot(createSnapshot("project-1", "task-1"));
      await vi.waitFor(() => expect(subscribeEvents).toHaveBeenCalledTimes(2));
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(subscribeEvents).toHaveBeenLastCalledWith(expect.objectContaining({ afterSequence: 5 }));
    } finally {
      runtime.dispose();
    }
  });

  it("restores native activity and reconnects only active tasks", async () => {
    const readTask = vi.fn(async (projectId: string, taskId: string) =>
      createSnapshot(projectId, taskId),
    );
    const subscribeEvents = vi.fn(() => () => undefined);
    const client = {
      readTask,
      releaseTaskSubscription: vi.fn(async () => undefined),
      retainTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents,
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    const tasks: readonly TaskActivitySnapshot[] = [
      {
        projectId: "project-1",
        requiresApproval: false,
        startedAt: "2026-09-02T08:00:00.000Z",
        status: "running",
        taskId: "task-1",
        taskName: "任务一",
      },
      {
        projectId: "project-1",
        requiresApproval: true,
        startedAt: "2026-09-02T08:05:00.000Z",
        status: "waiting",
        taskId: "task-2",
        taskName: "任务二",
      },
      {
        projectId: "project-2",
        requiresApproval: false,
        status: "completed",
        taskId: "task-3",
        taskName: "任务三",
      },
    ];

    await runtime.restoreTaskActivities(tasks);

    expect([...runtime.getTaskActivity().values()]).toEqual([
      expect.objectContaining({ isRunning: true, projectId: "project-1", taskId: "task-1" }),
      expect.objectContaining({ isRunning: true, projectId: "project-1", taskId: "task-2" }),
      expect.objectContaining({ attention: "completed", projectId: "project-2", taskId: "task-3" }),
    ]);
    expect(readTask).toHaveBeenCalledTimes(2);
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("does not let stale startup activity overwrite an unviewed completion event", async () => {
    let onEvent: SubscribeAgentEventsOptions["onEvent"] = () => undefined;
    const readTask = vi.fn(async (projectId: string, taskId: string) =>
      createSnapshot(projectId, taskId),
    );
    const client = {
      readTask,
      subscribeEvents: vi.fn((options: SubscribeAgentEventsOptions) => {
        onEvent = options.onEvent;
        return () => undefined;
      }),
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client);
    runtime.observeSnapshot(createSnapshot("project-1", "task-1"));
    onEvent({
      payload: {
        turn: {
          completedAt: "2026-09-02T08:01:00.000Z",
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-09-02T08:00:00.000Z",
          status: "completed",
        },
      },
      provider: "codex",
      sequence: 5,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-02T08:01:00.000Z",
      turnId: "turn-1",
      type: "turn.completed",
      version: 2,
    });

    await runtime.restoreTaskActivities([
      {
        projectId: "project-1",
        requiresApproval: false,
        startedAt: "2026-09-02T08:00:00.000Z",
        status: "running",
        taskId: "task-1",
        taskName: "任务一",
      },
    ]);

    expect(runtime.getTaskActivity().values().next().value).toMatchObject({
      attention: "completed",
      isRunning: false,
      taskName: "task-1",
    });
    expect(readTask).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("reports task recency as soon as a turn starts", () => {
    let onEvent: SubscribeAgentEventsOptions["onEvent"] = () => undefined;
    const onTaskMetadataChanged = vi.fn();
    const client = {
      readTask: vi.fn(async (projectId: string, taskId: string) =>
        createSnapshot(projectId, taskId),
      ),
      releaseTaskSubscription: vi.fn(async () => undefined),
      retainTaskSubscription: vi.fn(async () => undefined),
      subscribeEvents: vi.fn((options: SubscribeAgentEventsOptions) => {
        onEvent = options.onEvent;
        return () => undefined;
      }),
    } as unknown as NativeRuntimeClient;
    const runtime = createProjectRuntimeManager(client, { onTaskMetadataChanged });
    runtime.observeSnapshot(createSnapshot("project-1", "task-1"));
    const event: AgentEvent = {
      payload: {
        turn: {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [],
          startedAt: "2026-09-03T08:00:00.000Z",
          status: "running",
        },
      },
      provider: "codex",
      sequence: 5,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-03T08:00:00.000Z",
      turnId: "turn-1",
      type: "turn.started",
      version: 2,
    };

    onEvent(event);

    expect(onTaskMetadataChanged).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      "turn_started",
      event.timestamp,
    );
    runtime.dispose();
  });
});
