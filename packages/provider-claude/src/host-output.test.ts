import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import * as fs from "node:fs";
import { expect, it, vi } from "vitest";
import { createHostOutputStream, HostOutput } from "./host-output.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof fs>()),
  write: vi.fn(),
}));

it("retries temporary pipe backpressure after a short write without losing or duplicating bytes", async () => {
  const received: Buffer[] = [];
  let calls = 0;
  vi.mocked(fs.write).mockImplementation((...args: unknown[]) => {
    const [, chunk, offset, length, , callback] = args as [
      number,
      Buffer,
      number,
      number,
      null,
      (error: NodeJS.ErrnoException | null, written: number) => void,
    ];
    calls++;
    const code = calls === 2 ? "EAGAIN" : calls === 3 ? "EWOULDBLOCK" : undefined;
    if (code) {
      queueMicrotask(() => {
        callback(Object.assign(new Error(code), { code }), 0);
      });
      return;
    }
    const bytes = Math.min(length, 7);
    received.push(Buffer.from(chunk.subarray(offset, offset + bytes)));
    queueMicrotask(() => {
      callback(null, bytes);
    });
  });
  const output = createHostOutputStream(1);
  const input = Buffer.from(`${JSON.stringify({ result: "pipe pressure ".repeat(16) })}\n`);
  const completed = finished(output);
  output.end(input);
  await completed;
  expect(Buffer.concat(received)).toEqual(input);
  expect(calls).toBeGreaterThan(3);
});

it("propagates a permanently broken output pipe", async () => {
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  vi.mocked(fs.write).mockImplementation((...args: unknown[]) => {
    const callback = args[5] as (error: NodeJS.ErrnoException, written: number) => void;
    queueMicrotask(() => {
      callback(error, 0);
    });
  });
  const output = createHostOutputStream(1);
  const failed = new Promise<Error>((resolve) => output.once("error", resolve));
  output.end("frame\n");
  expect(await failed).toBe(error);
});

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
