import { expect, it, vi } from "vitest";
import { createRuntimeEventAcknowledger } from "./runtime-event-ack.js";

it("batches completed consumption and keeps only one ACK invoke in flight", async () => {
  let release = () => {};
  const send = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const ack = createRuntimeEventAcknowledger(send);
  ack({ streamId: 1, deliveryId: 1 });
  ack({ streamId: 1, deliveryId: 2 });
  expect(send).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith(1, [1, 2]);
  ack({ streamId: 1, deliveryId: 3 });
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(send).toHaveBeenLastCalledWith(1, [3]);
  release();
});

it("retries the same delivery IDs after failure without releasing invented credits", async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue(undefined);
  const ack = createRuntimeEventAcknowledger(send);
  try {
    ack({ streamId: 7, deliveryId: 9 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(7, [9]);
  } finally {
    vi.useRealTimers();
  }
});
