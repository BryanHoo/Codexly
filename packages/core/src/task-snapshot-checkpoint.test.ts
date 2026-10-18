import { expect, it, vi } from "vitest";
import type {
  AgentProvider,
  AgentProviderEventListener,
  AgentProviderTaskSnapshot,
} from "./agent-provider.js";
import { readTaskWithCheckpoint } from "./task-snapshot-checkpoint.js";

function harness() {
  const listeners = new Set<AgentProviderEventListener>();
  const snapshot: AgentProviderTaskSnapshot = {
    id: "task",
    projectId: "project",
    title: "任务",
    pinned: false,
    updatedAt: "2026-10-17T00:00:00Z",
    status: "running",
    contextUsage: null,
    goal: null,
    plan: null,
    pendingRequests: [],
    turns: [],
    turnsNextCursor: null,
  };
  const provider = {
    subscribeEvents: (listener: AgentProviderEventListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readTask: vi.fn<AgentProvider["readTask"]>(() => Promise.resolve(snapshot)),
  };
  const emit = (taskId = "task") => {
    for (const listener of listeners)
      listener({
        type: "message.delta",
        taskId,
        turnId: "turn",
        itemId: "item",
        payload: { delta: "增量" },
      });
  };
  return { provider, listeners, snapshot, emit };
}

it("captures the boundary synchronously before a following event, with no duplicate subscriptions", async () => {
  const h = harness();
  let sequence = 3;
  const response = await readTaskWithCheckpoint(h.provider, "task", { summary: true }, () => {
    queueMicrotask(() => {
      sequence++;
      h.emit();
    });
    return sequence;
  });
  expect(response?.checkpoint).toBe(3);
  expect(sequence).toBe(4);
  expect(h.provider.readTask).toHaveBeenCalledOnce();
  expect(h.provider.readTask).toHaveBeenCalledWith(
    "task",
    expect.objectContaining({ summary: true }),
  );
  expect(h.listeners.size).toBe(0);
});

it("ignores other tasks while checking a paginated snapshot", async () => {
  const h = harness();
  h.provider.readTask.mockImplementationOnce(() => {
    h.emit("other");
    return Promise.resolve(h.snapshot);
  });
  const response = await readTaskWithCheckpoint(h.provider, "task", { cursor: "older" }, () => 5);
  expect(response?.checkpoint).toBe(5);
  expect(h.provider.readTask).toHaveBeenCalledOnce();
});

it("bounds retries under continuous output and releases its listener without acknowledging a snapshot", async () => {
  const h = harness();
  h.provider.readTask.mockImplementation(() => {
    h.emit();
    return Promise.resolve(h.snapshot);
  });
  const capture = vi.fn();
  await expect(readTaskWithCheckpoint(h.provider, "task", {}, capture)).rejects.toThrow(
    "Task snapshot is temporarily busy",
  );
  expect(h.provider.readTask).toHaveBeenCalledTimes(2);
  expect(capture).not.toHaveBeenCalled();
  expect(h.listeners.size).toBe(0);
});

it.each(["missing", "read failure", "capture failure"])("cleans up after %s", async (outcome) => {
  const h = harness();
  if (outcome === "missing") h.provider.readTask.mockResolvedValue(undefined);
  if (outcome === "read failure") h.provider.readTask.mockRejectedValue(new Error(outcome));
  const capture = vi.fn(() => {
    throw new Error(outcome);
  });
  const read = readTaskWithCheckpoint(h.provider, "task", {}, capture);
  if (outcome === "missing") {
    await expect(read).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  } else await expect(read).rejects.toThrow(outcome);
  expect(h.listeners.size).toBe(0);
});

it("does not reread summaries for deltas of messages outside the summary", async () => {
  const h = harness();
  h.provider.readTask.mockImplementation(() => {
    h.emit();
    return Promise.resolve(h.snapshot);
  });
  await expect(
    readTaskWithCheckpoint(h.provider, "task", { summary: true }, () => 9),
  ).resolves.toMatchObject({ checkpoint: 9 });
  expect(h.provider.readTask).toHaveBeenCalledOnce();
});

it("accepts a provider's synchronous delta overlay without waiting for quiet output", async () => {
  const h = harness();
  h.provider.readTask.mockImplementation(async (_id, input) => {
    h.emit();
    await Promise.resolve();
    input?.snapshotRead?.capture(h.snapshot);
    // 捕获之后的事件必须留给回放，不能使已绑定的快照重新读取。
    h.emit();
    return h.snapshot;
  });
  await expect(readTaskWithCheckpoint(h.provider, "task", {}, () => 7)).resolves.toMatchObject({
    checkpoint: 7,
  });
  expect(h.provider.readTask).toHaveBeenCalledOnce();
});

it("shares stable preparation across conflicts but never accepts a stale structural capture", async () => {
  const h = harness();
  const prepare = vi.fn(() => Promise.resolve("prepared"));
  h.provider.readTask.mockImplementation(async (_id, input) => {
    await input?.snapshotRead?.prepare("stable", prepare);
    for (const listener of h.listeners)
      listener({
        type: "task.status_updated",
        taskId: "task",
        payload: { status: "running" },
      });
    input?.snapshotRead?.capture(h.snapshot);
    return h.snapshot;
  });
  await expect(readTaskWithCheckpoint(h.provider, "task", {}, vi.fn())).rejects.toMatchObject({
    code: "TASK_SNAPSHOT_BUSY",
    statusCode: 503,
    retryable: true,
  });
  expect(prepare).toHaveBeenCalledOnce();
  expect(h.listeners.size).toBe(0);
});

it("does not start reading an already cancelled request", async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await expect(
    readTaskWithCheckpoint(h.provider, "task", { signal: controller.signal }, vi.fn()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(h.provider.readTask).not.toHaveBeenCalled();
  expect(h.listeners.size).toBe(0);
});

it.each(["cancel", "deadline"] as const)(
  "releases a pending read on %s without late retries",
  async (mode) => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const controller = new AbortController();
      const pending = Promise.withResolvers<typeof h.snapshot>();
      const capture = vi.fn();
      let readingSignal: AbortSignal | undefined;
      h.provider.readTask.mockImplementation((_id, input) => {
        readingSignal = input?.signal;
        return pending.promise;
      });
      const reading = readTaskWithCheckpoint(
        h.provider,
        "task",
        { signal: controller.signal },
        capture,
        { timeoutMs: 50 },
      );
      const rejected = expect(reading).rejects.toMatchObject(
        mode === "cancel"
          ? { name: "AbortError" }
          : { code: "TASK_SNAPSHOT_BUSY", statusCode: 503, retryable: true },
      );
      if (mode === "cancel") controller.abort();
      else await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(readingSignal?.aborted).toBe(true);
      expect(h.listeners.size).toBe(0);
      pending.resolve(h.snapshot);
      await Promise.resolve();
      expect(h.provider.readTask).toHaveBeenCalledOnce();
      expect(capture).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("does not ignore deltas of messages present in a summary", async () => {
  const h = harness();
  const snapshot = {
    ...h.snapshot,
    turns: [
      {
        id: "turn",
        status: "running",
        startedAt: null,
        completedAt: null,
        error: null,
        items: [
          { id: "item", type: "message", role: "assistant", text: "初始", phase: "final_answer" },
        ],
      },
    ],
  } as AgentProviderTaskSnapshot;
  h.provider.readTask.mockImplementation(() => {
    h.emit();
    return Promise.resolve(snapshot);
  });
  await expect(
    readTaskWithCheckpoint(h.provider, "task", { summary: true }, vi.fn()),
  ).rejects.toMatchObject({ code: "TASK_SNAPSHOT_BUSY" });
  expect(h.provider.readTask).toHaveBeenCalledTimes(2);
});

it("shares one absolute deadline across both attempts", async () => {
  vi.useFakeTimers();
  try {
    const h = harness();
    const pending = Promise.withResolvers<typeof h.snapshot>();
    h.provider.readTask
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        h.emit();
        return h.snapshot;
      })
      .mockImplementationOnce(() => pending.promise);
    const reading = readTaskWithCheckpoint(h.provider, "task", {}, vi.fn(), { timeoutMs: 50 });
    const rejected = expect(reading).rejects.toMatchObject({ code: "TASK_SNAPSHOT_BUSY" });
    await vi.advanceTimersByTimeAsync(40);
    expect(h.provider.readTask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve(h.snapshot);
  } finally {
    vi.useRealTimers();
  }
});
