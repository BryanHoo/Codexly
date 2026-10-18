import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeVisibleToolClock } from "./tool-duration-clock.js";

// 使用受控的文档和观察器，验证后台与离屏期间不会产生定时更新。
let visibility: DocumentVisibilityState;
let visibilityChanged: (() => void) | undefined;
let intersect: IntersectionObserverCallback;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
const removeVisibilityListener = vi.fn();
let cleanups: (() => void)[];

function setVisible(element: Element, visible: boolean) {
  intersect(
    [{ target: element, isIntersecting: visible } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

function subscribe() {
  const element = {} as Element;
  const listener = vi.fn();
  cleanups.push(subscribeVisibleToolClock(element, listener));
  return { element, listener };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  vi.clearAllMocks();
  visibility = "visible";
  cleanups = [];
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      visibilityChanged = listener;
    }),
    removeEventListener: removeVisibilityListener,
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("visible tool clock", () => {
  it("shares one 100ms timer among visible tools and leaves offscreen tools idle", () => {
    const first = subscribe();
    const second = subscribe();
    const offscreen = subscribe();
    expect(vi.getTimerCount()).toBe(0);
    setVisible(first.element, true);
    setVisible(second.element, true);
    expect(vi.getTimerCount()).toBe(1);
    first.listener.mockClear();
    second.listener.mockClear();
    vi.advanceTimersByTime(300);
    expect(first.listener.mock.calls).toEqual([[1_100], [1_200], [1_300]]);
    expect(second.listener.mock.calls).toEqual(first.listener.mock.calls);
    expect(offscreen.listener).not.toHaveBeenCalled();
  });

  it("stops when all tools leave the viewport and immediately catches up on return", () => {
    const tool = subscribe();
    setVisible(tool.element, true);
    setVisible(tool.element, false);
    tool.listener.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(tool.listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    setVisible(tool.element, true);
    expect(tool.listener).toHaveBeenCalledExactlyOnceWith(6_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pauses immediately in a hidden document and catches up only visible tools", () => {
    const tool = subscribe();
    const offscreen = subscribe();
    setVisible(tool.element, true);
    visibility = "hidden";
    visibilityChanged?.();
    tool.listener.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(tool.listener).not.toHaveBeenCalled();
    visibility = "visible";
    visibilityChanged?.();
    expect(tool.listener).toHaveBeenCalledExactlyOnceWith(11_000);
    expect(offscreen.listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not start a timer when mounted hidden and releases all shared resources", () => {
    visibility = "hidden";
    const tool = subscribe();
    setVisible(tool.element, true);
    expect(tool.listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    cleanups[0]?.();
    expect(unobserve).toHaveBeenCalledWith(tool.element);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeVisibilityListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("removes completed or unmounted subscriptions without stopping other visible tools", () => {
    const first = subscribe();
    const second = subscribe();
    setVisible(first.element, true);
    setVisible(second.element, true);
    cleanups[0]?.();
    first.listener.mockClear();
    second.listener.mockClear();
    vi.advanceTimersByTime(100);
    expect(first.listener).not.toHaveBeenCalled();
    expect(second.listener).toHaveBeenCalledExactlyOnceWith(1_100);
    cleanups[1]?.();
    expect(vi.getTimerCount()).toBe(0);
    // 已排队的观察通知在清理后到达，也不能重新启动时钟。
    setVisible(first.element, true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to document visibility when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const tool = subscribe();
    expect(vi.getTimerCount()).toBe(1);
    expect(tool.listener).toHaveBeenCalledExactlyOnceWith(1_000);
    visibility = "hidden";
    visibilityChanged?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
