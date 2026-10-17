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
  expect(h.provider.readTask).toHaveBeenCalledWith("task", { summary: true });
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
    "Task changed",
  );
  expect(h.provider.readTask).toHaveBeenCalledTimes(8);
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
