import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalInput } from "./terminal-input.js";

describe("terminal input", () => {
  afterEach(() => vi.useRealTimers());
  it("preserves legacy binary mouse input instead of UTF-8 encoding it", async () => {
    const write = vi.fn(async () => undefined);
    const input = new TerminalInput(write, vi.fn());
    input.sendBinary("\x1b[M\xff");
    await Promise.resolve();
    expect(write).toHaveBeenCalledWith(1n, new Uint8Array([27, 91, 77, 255]));
    expect(input.queuedBytes).toBe(0);
  });
  it("retries only rejected queue-full input without advancing its sequence", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce({ code: "TERMINAL_INPUT_QUEUE_FULL" }).mockResolvedValue(undefined);
    const fail = vi.fn();
    const input = new TerminalInput(write, fail);
    input.send("abc");
    await vi.advanceTimersByTimeAsync(8);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map((call) => call[0])).toEqual([1n, 1n]);
    expect(input.queuedBytes).toBe(0);
    expect(fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("serializes chunks and cancels unsent paste before interrupt", async () => {
    let release: (() => void) | undefined;
    const write = vi.fn((_sequence: bigint, _bytes: Uint8Array) => new Promise<void>((resolve) => { release = resolve; }));
    const input = new TerminalInput(write, vi.fn());
    input.send("a".repeat(40000));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[1]).toHaveLength(16384);
    input.send("\x03");
    release?.();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]).toEqual([2n, new Uint8Array([3])]);
    release?.();
    await Promise.resolve();
    expect(input.queuedBytes).toBe(0);
  });

  it("cancels a rejected paste and reuses its unaccepted sequence for interrupt", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce({ code: "TERMINAL_INPUT_QUEUE_FULL" }).mockResolvedValue(undefined);
    const input = new TerminalInput(write, vi.fn());
    input.send("paste");
    await vi.advanceTimersByTimeAsync(0);
    input.send("\x03");
    await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls[1]).toEqual([1n, new Uint8Array([3])]);
    expect(input.queuedBytes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends an accepted bracketed paste before sending interrupt", async () => {
    let release: (() => void) | undefined;
    const write = vi.fn((_sequence: bigint, _bytes: Uint8Array) => new Promise<void>((resolve) => { release = resolve; }));
    const input = new TerminalInput(write, vi.fn());
    input.send("\x1b[200~" + "a".repeat(40000) + "\x1b[201~");
    input.send("\x03");
    release?.();
    await Promise.resolve();
    expect(write.mock.calls[1]?.[1]).toEqual(new TextEncoder().encode("\x1b[201~\x03"));
    release?.();
    await Promise.resolve();
    expect(input.queuedBytes).toBe(0);
  });

  it("bounds queue-full retries and clears the pending timer on disposal", async () => {
    vi.useFakeTimers();
    const fail = vi.fn();
    const write = vi.fn().mockRejectedValue({ code: "TERMINAL_INPUT_QUEUE_FULL" });
    const input = new TerminalInput(write, fail);
    input.send("paste");
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(64);
    expect(fail).toHaveBeenCalledOnce();
    expect(input.queuedBytes).toBe(0);
    const next = new TerminalInput(write, fail);
    next.send("paste");
    await vi.advanceTimersByTimeAsync(0);
    next.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects oversized paste without retaining input", () => {
    const fail = vi.fn();
    const write = vi.fn(async () => undefined);
    const input = new TerminalInput(write, fail);
    input.send("a".repeat(1024 * 1024 + 1));
    expect(write).not.toHaveBeenCalled();
    expect(input.queuedBytes).toBe(0);
    expect(fail).toHaveBeenCalledOnce();
  });

  it("stops unsent input after transport failure", async () => {
    const fail = vi.fn();
    const write = vi.fn(async () => { throw new Error("TERMINAL_NOT_FOUND"); });
    const input = new TerminalInput(write, fail);
    input.send("a".repeat(40000));
    await Promise.resolve();
    input.send("later");
    expect(write).toHaveBeenCalledTimes(1);
    expect(input.queuedBytes).toBe(0);
    expect(fail).toHaveBeenCalledOnce();
  });
});
