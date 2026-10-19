import { afterEach, expect, test, vi } from "vitest";
import { RetainedWorkBudget } from "@codexly/core";
import { TaskNotificationQueue } from "./task-notification-queue.js";

afterEach(() => vi.useRealTimers());

function budget(maxCount = 4, maxBytes = 16_384) {
  return new RetainedWorkBudget({ maxCount, maxBytes, maxTaskCount: 3, maxTaskBytes: 8192 });
}

test("bounds 4096 independent payloads and recovers in FIFO order without losing terminal events", () => {
  const retained = budget();
  const queue = new TaskNotificationQueue(retained);
  const delivered: number[] = [];
  queue.run(
    "task",
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            delivered.push(-1);
            resolve();
          },
          { once: true },
        );
      }),
    () => undefined,
    4096,
  );
  for (let index = 0; index < 4096; index++) {
    const payload = `${String(index)}:`.padEnd(4096, "x");
    queue.run(
      "task",
      () => {
        delivered.push(Number(payload.split(":", 1)[0]));
      },
      () => undefined,
      4096,
    );
    expect(retained.usage.count).toBeLessThanOrEqual(4);
    expect(retained.usage.bytes).toBeLessThanOrEqual(16_384);
  }
  expect(delivered).toEqual([-1, ...Array.from({ length: 4096 }, (_, index) => index)]);
  expect(retained.usage.count).toBe(0);
});

test("shares the process budget across providers and includes active work", () => {
  const retained = budget(2);
  const first = new TaskNotificationQueue(retained);
  const second = new TaskNotificationQueue(retained);
  first.run(
    "a",
    () => new Promise(() => undefined),
    () => undefined,
    100,
  );
  first.run(
    "b",
    () => new Promise(() => undefined),
    () => undefined,
    100,
  );
  const receive = vi.fn((_signal: AbortSignal) => undefined);
  second.run("c", receive, () => undefined, 100);
  expect(receive.mock.calls[0]?.[0].aborted).toBe(true);
  expect(retained.usage.count).toBe(2);
  first.dispose();
  expect(retained.usage.count).toBe(0);
});

test("uses an enqueue deadline, degrades queued work in order and cancels on clear", async () => {
  vi.useFakeTimers();
  const retained = budget();
  const queue = new TaskNotificationQueue(retained, 50);
  const signals: AbortSignal[] = [];
  const receive = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<void>(() => undefined);
  });
  queue.run("task", receive, () => undefined, 100);
  queue.run(
    "task",
    (signal) => {
      expect(signal.aborted).toBe(true);
    },
    () => undefined,
    100,
  );
  await vi.advanceTimersByTimeAsync(50);
  expect(signals[0]?.aborted).toBe(true);
  expect(retained.usage.count).toBe(0);
  queue.run("task", receive, () => undefined, 100);
  queue.clearTask("task");
  expect(signals[1]?.aborted).toBe(true);
  expect(retained.usage.count).toBe(0);
  queue.dispose();
});

test("enforces the per-task count budget while bytes and process count still have room", () => {
  const retained = budget(10);
  const queue = new TaskNotificationQueue(retained);
  const delivered: number[] = [];
  queue.run(
    "task",
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            delivered.push(0);
            resolve();
          },
          { once: true },
        );
      }),
    () => undefined,
    1,
  );
  for (let index = 1; index <= 3; index++)
    queue.run(
      "task",
      () => {
        delivered.push(index);
      },
      () => undefined,
      1,
    );
  expect(delivered).toEqual([0, 1, 2, 3]);
  expect(retained.usage.count).toBe(0);
});
