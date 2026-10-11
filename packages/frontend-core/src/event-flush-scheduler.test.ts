import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleEventFlush } from "./event-flush-scheduler.js";

class VisibilityTarget extends EventTarget {
  public visibilityState: DocumentVisibilityState = "visible";
}

describe("scheduleEventFlush", () => {
  let visibility: EventTarget & { visibilityState: DocumentVisibilityState };
  let frames: FrameRequestCallback[];
  let cancelFlush: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = new VisibilityTarget();
    frames = [];
    vi.stubGlobal("document", visibility);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    cancelFlush = undefined;
  });

  afterEach(() => {
    cancelFlush?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setVisibility(state: DocumentVisibilityState): void {
    visibility.visibilityState = state;
    visibility.dispatchEvent(new Event("visibilitychange"));
  }

  it("可见时通过下一帧提交，提交后不保留监听器或定时器", () => {
    const removeListener = vi.spyOn(visibility, "removeEventListener");
    const flush = vi.fn();
    cancelFlush = scheduleEventFlush(flush);
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(flush).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("恢复可见时取消后台计时器并通过下一帧提交", () => {
    setVisibility("hidden");
    const flush = vi.fn();
    cancelFlush = scheduleEventFlush(flush);
    expect(frames).toHaveLength(0);
    setVisibility("visible");
    expect(vi.getTimerCount()).toBe(0);
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    vi.advanceTimersByTime(1_000);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("快速切换前后台时丢弃旧帧，始终只有一个待提交回调", () => {
    const flush = vi.fn();
    cancelFlush = scheduleEventFlush(flush);
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    for (const frame of frames) frame(0);
    expect(flush).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(16);
    expect(flush).toHaveBeenCalledOnce();
  });

  it.each(["visible", "hidden"] as const)(
    "%s 状态取消后释放资源，旧回调不能消费新批次",
    (state) => {
      setVisibility(state);
      const removeListener = vi.spyOn(visibility, "removeEventListener");
      const staleFlush = vi.fn();
      cancelFlush = scheduleEventFlush(staleFlush);
      cancelFlush();
      expect(removeListener).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      const flush = vi.fn();
      cancelFlush = scheduleEventFlush(flush);
      if (state === "visible") {
        frames[0]?.(0);
        expect(flush).not.toHaveBeenCalled();
        frames[1]?.(0);
      }
      vi.advanceTimersByTime(16);
      expect(staleFlush).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalledOnce();
    },
  );
});
