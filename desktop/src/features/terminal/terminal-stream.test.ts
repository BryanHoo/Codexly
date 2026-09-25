import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalStream } from "./terminal-stream.js";

function frame(sequence: bigint, offset: bigint, bytes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + bytes.length);
  const view = new DataView(buffer);
  view.setBigUint64(0, sequence, true);
  view.setBigUint64(8, offset, true);
  new Uint8Array(buffer, 16).set(bytes);
  return buffer;
}

describe("terminal stream", () => {
  afterEach(() => vi.useRealTimers());
  it("acknowledges only parsed bytes and flushes the tail once", async () => {
    vi.useFakeTimers();
    const callbacks: (() => void)[] = [];
    const ack = vi.fn(async () => undefined);
    const stream = new TerminalStream({ write: (_bytes, parsed) => callbacks.push(parsed), ack, fail: vi.fn() });
    stream.accept(frame(1n, 1n, [0xe4]));
    await vi.advanceTimersByTimeAsync(20);
    expect(ack).not.toHaveBeenCalled();
    callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(8);
    expect(ack).toHaveBeenCalledExactlyOnceWith("1");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("waits for trailing output when exit arrives first", () => {
    const callbacks: (() => void)[] = [];
    const done = vi.fn();
    const stream = new TerminalStream({ write: (_bytes, parsed) => callbacks.push(parsed), ack: async () => undefined, fail: vi.fn() });
    stream.finish("2", done);
    stream.accept(frame(1n, 2n, [65, 66]));
    expect(done).not.toHaveBeenCalled();
    callbacks[0]?.();
    expect(done).toHaveBeenCalledOnce();
    stream.dispose();
  });
  it("fails explicitly on gaps and ignores callbacks after disposal", () => {
    const fail = vi.fn();
    const write = vi.fn();
    const stream = new TerminalStream({ write, ack: async () => undefined, fail });
    stream.accept(frame(2n, 1n, [65]));
    stream.accept(frame(1n, 1n, [65]));
    expect(fail).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects output beyond the final offset after completing exit", () => {
    const fail = vi.fn();
    const done = vi.fn();
    const stream = new TerminalStream({ write: (_bytes, parsed) => parsed(), ack: async () => undefined, fail });
    stream.finish("0", done);
    stream.accept(frame(1n, 1n, [65]));
    expect(done).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledOnce();
    stream.dispose();
  });
});
