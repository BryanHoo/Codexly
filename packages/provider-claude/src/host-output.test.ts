import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { HostOutput } from "./host-output.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function pausedOutput() {
  const frames: string[] = [];
  const callbacks: (() => void)[] = [];
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      frames.push(String(chunk));
      callbacks.push(callback);
    },
  });
  return { stream, frames, drain: () => callbacks.shift()?.() };
}
function delta(text: string, itemId = "message") {
  return {
    projectId: "p",
    event: { type: "message.delta", taskId: "t", turnId: "r", itemId, payload: { delta: text } },
  };
}

it("preserves critical barriers and merges adjacent deltas while the reader pauses", async () => {
  const sink = pausedOutput(),
    failed = vi.fn();
  const output = new HostOutput(sink.stream, failed);
  output.send({ id: 1, result: null });
  await tick();
  output.send(delta("你"));
  output.send(delta("好"));
  output.send({ event: { type: "approval.requested" } });
  output.send(delta("后"));
  output.send({ id: 2, result: "snapshot" });
  expect(sink.frames).toHaveLength(1);
  for (let i = 0; i < 5; i++) {
    sink.drain();
    await tick();
  }
  expect(sink.frames.map((frame) => JSON.parse(frame) as unknown)).toEqual([
    { id: 1, result: null },
    delta("你好"),
    { event: { type: "approval.requested" } },
    delta("后"),
    { id: 2, result: "snapshot" },
  ]);
  expect(failed).not.toHaveBeenCalled();
  output.close();
  sink.stream.destroy();
});

it("bounds UTF-8 queue bytes and reports overflow outside the SDK listener", async () => {
  const sink = pausedOutput(),
    failed = vi.fn();
  const output = new HostOutput(sink.stream, failed, 1024);
  expect(() => {
    for (let i = 0; i < 50; i++) output.send(delta("文".repeat(100), String(i)));
  }).not.toThrow();
  expect(output.bufferedBytes).toBeLessThanOrEqual(1024);
  expect(failed).not.toHaveBeenCalled();
  await tick();
  expect(failed).toHaveBeenCalledExactlyOnceWith("stdout queue budget exceeded");
  expect(output.send({ id: 9 })).toBe(false);
  sink.stream.destroy();
});

it("handles broken pipes and drain timeouts without an uncaught rejection", async () => {
  const sink = pausedOutput(),
    failed = vi.fn();
  const output = new HostOutput(sink.stream, failed, 1024, 10);
  output.send({ id: 1 });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(failed).toHaveBeenCalledExactlyOnceWith("stdout drain timed out");
  sink.stream.destroy(new Error("EPIPE secret"));
  await tick();
  expect(failed).toHaveBeenCalledTimes(1);
});
