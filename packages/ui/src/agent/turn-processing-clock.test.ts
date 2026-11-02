import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 直接执行共享计时 Hook 的 effect，观察真实定时器与状态提交，避免仅断言源码结构。
const hooks = vi.hoisted(() => ({ effects: [] as React.EffectCallback[], setNow: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: React.EffectCallback) => hooks.effects.push(effect),
  useState: () => [Date.now(), hooks.setNow],
}));

import { useTurnProcessingTime } from "./use-turn-processing-time.js";

let visibility: DocumentVisibilityState;
let target: EventTarget;
let cleanups: (() => void)[];

function mount(status: "running" | "completed" = "running") {
  hooks.effects = [];
  useTurnProcessingTime({ status, startedAt: new Date(0).toISOString(), completedAt: null });
  for (const effect of hooks.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}

function changeVisibility(value: DocumentVisibilityState) {
  visibility = value;
  target.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  hooks.setNow.mockClear();
  visibility = "visible";
  cleanups = [];
  target = new EventTarget();
  vi.stubGlobal("document", target);
  Object.defineProperty(target, "visibilityState", { get: () => visibility });
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("turn processing clock", () => {
  it("stops hidden updates and immediately catches up using the current timestamp", () => {
    mount();
    vi.advanceTimersByTime(1_000);
    expect(hooks.setNow).toHaveBeenLastCalledWith(2_000);
    changeVisibility("hidden");
    hooks.setNow.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(hooks.setNow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    changeVisibility("visible");
    expect(hooks.setNow).toHaveBeenCalledExactlyOnceWith(12_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stays idle when mounted hidden and calibrates on first visibility", () => {
    changeVisibility("hidden");
    mount();
    expect(vi.getTimerCount()).toBe(0);
    expect(hooks.setNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    changeVisibility("visible");
    expect(hooks.setNow).toHaveBeenCalledExactlyOnceWith(21_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not subscribe completed turns even without a completion timestamp", () => {
    mount("completed");
    vi.advanceTimersByTime(5_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(hooks.setNow).not.toHaveBeenCalled();
  });

  it("shares a single timer and releases listeners after the final unmount", () => {
    const removeListener = vi.spyOn(target, "removeEventListener");
    mount();
    mount();
    expect(vi.getTimerCount()).toBe(1);
    cleanups.shift()?.();
    expect(vi.getTimerCount()).toBe(1);
    cleanups.shift()?.();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    hooks.setNow.mockClear();
    changeVisibility("visible");
    expect(hooks.setNow).not.toHaveBeenCalled();
  });
});
