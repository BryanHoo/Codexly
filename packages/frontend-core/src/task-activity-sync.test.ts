import { afterEach, expect, test, vi } from "vitest";
import {
  installTaskActivitySync,
  reconcileActivitySnapshots,
  projectTaskActivitySnapshot,
} from "./task-activity-sync.js";
import type { TaskActivitySnapshot } from "@codexly/protocol";
const task: TaskActivitySnapshot = {
  projectId: "p",
  taskId: "t",
  taskName: "后台",
  status: "running",
  requiresApproval: false,
};
afterEach(() => vi.useRealTimers());

test("coalesces invalidations, performs one follow-up read and cancels late results on dispose", async () => {
  let notify: () => void = vi.fn();
  let finish!: (tasks: readonly TaskActivitySnapshot[]) => void;
  const cleanup = vi.fn();
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue([task]);
  const apply = vi.fn();
  const stop = installTaskActivitySync({
    read,
    capture: () => 1,
    apply,
    subscribe: (refresh) => {
      notify = refresh;
      return cleanup;
    },
    onError: vi.fn(),
  });
  await vi.waitFor(() => {
    expect(read).toHaveBeenCalledTimes(1);
  });
  notify();
  notify();
  notify();
  finish([task]);
  await vi.waitFor(() => {
    expect(read).toHaveBeenCalledTimes(2);
  });
  await vi.waitFor(() => {
    expect(apply).toHaveBeenCalledTimes(2);
  });
  notify();
  stop();
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  expect(cleanup).toHaveBeenCalledOnce();
});

test("retries a failed read without clearing activity and releases the retry timer", async () => {
  vi.useFakeTimers();
  const apply = vi.fn();
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([task]);
  const stop = installTaskActivitySync({
    read,
    capture: () => 1,
    apply,
    subscribe: () => vi.fn<() => void>(),
    onError: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(apply).toHaveBeenCalledWith([task], 1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

test("preserves live updates during snapshot omission and later removes acknowledged records", () => {
  const key = "p\u0000t",
    first = {},
    live = {},
    synchronized = new Set([key]);
  const baseline = new Map([[key, first]]),
    current = new Map([[key, live]]);
  const update = vi.fn(() => ({}));
  expect(reconcileActivitySnapshots(current, baseline, [], synchronized, update)).toBe(current);
  expect(reconcileActivitySnapshots(current, current, [], synchronized, update).size).toBe(0);
});

test("recovers a failed listener registration and reads without waiting for a user action", async () => {
  vi.useFakeTimers();
  const cleanup = vi.fn(),
    apply = vi.fn();
  const subscribe = vi
    .fn()
    .mockRejectedValueOnce(new Error("bridge starting"))
    .mockReturnValue(cleanup);
  const stop = installTaskActivitySync({
    read: () => Promise.resolve([task]),
    capture: () => 1,
    apply,
    subscribe,
    onError: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(subscribe).toHaveBeenCalledTimes(2);
  stop();
  expect(cleanup).toHaveBeenCalledOnce();
});

test("preserves an authoritative approval flag when a native active update arrives during approval", () => {
  const projection = projectTaskActivitySnapshot({
    ...task,
    status: "running",
    requiresApproval: true,
  });
  expect(projection.attention).toBe("approval");
  expect(projection.pendingApprovalRequestIds.size).toBe(1);
});
