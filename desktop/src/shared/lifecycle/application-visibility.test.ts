import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DelayedBackgroundSuspension,
  installApplicationSuspensionEffects,
  runDetailViewInterval,
  type DetailViewUpdateGate,
} from "./application-visibility.js";

class FakeApplicationTarget {
  public visibilityState: DocumentVisibilityState = "visible";
  readonly #listeners = new Map<string, Set<() => void>>();

  public addEventListener(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: () => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public setFocused(focused: boolean): void {
    this.#dispatch(focused ? "focus" : "blur");
  }

  public setVisibility(visibilityState: DocumentVisibilityState): void {
    this.visibilityState = visibilityState;
    this.#dispatch("visibilitychange");
  }

  #dispatch(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener();
  }
}

describe("DelayedBackgroundSuspension", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("只在持续隐藏达到阈值后暂停，并忽略短时间前后台切换", () => {
    vi.useFakeTimers();
    const target = new FakeApplicationTarget();
    const suspension = new DelayedBackgroundSuspension(target);
    const listener = vi.fn();
    suspension.subscribe(listener);

    target.setVisibility("hidden");
    vi.advanceTimersByTime(59_999);
    expect(suspension.isSuspended()).toBe(false);

    target.setVisibility("visible");
    vi.advanceTimersByTime(60_000);
    expect(suspension.isSuspended()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    target.setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(suspension.isSuspended()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    target.setVisibility("visible");
    expect(suspension.isSuspended()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    suspension.dispose();
  });

  it("可见时持续失焦仍保持运行，仅在隐藏后暂停", () => {
    vi.useFakeTimers();
    const target = new FakeApplicationTarget();
    const suspension = new DelayedBackgroundSuspension(target, 5_000);
    const listener = vi.fn();
    suspension.subscribe(listener);

    target.setFocused(false);
    vi.advanceTimersByTime(5_000);
    expect(suspension.isSuspended()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    target.setVisibility("hidden");
    vi.advanceTimersByTime(5_000);
    expect(suspension.isSuspended()).toBe(true);

    target.setVisibility("visible");
    target.setFocused(true);
    expect(suspension.isSuspended()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    suspension.dispose();
  });

  it("暂停时停止详细视图计时器，并在恢复时立即校准", () => {
    vi.useFakeTimers();
    const listeners = new Set<() => void>();
    let suspended = false;
    const gate: DetailViewUpdateGate = {
      isSuspended: () => suspended,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const tick = vi.fn();
    const dispose = runDetailViewInterval(gate, tick, 1_000);

    vi.advanceTimersByTime(2_000);
    expect(tick).toHaveBeenCalledTimes(2);

    suspended = true;
    for (const listener of listeners) listener();
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2);

    suspended = false;
    for (const listener of listeners) listener();
    expect(tick).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1_000);
    expect(tick).toHaveBeenCalledTimes(4);

    dispose();
  });

  it("暂停和恢复时各同步一次动画与轮询状态", () => {
    const listeners = new Set<() => void>();
    let suspended = false;
    const gate: DetailViewUpdateGate = {
      isSuspended: () => suspended,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const setAnimationsSuspended = vi.fn();
    const setPollingActive = vi.fn();
    const dispose = installApplicationSuspensionEffects(gate, {
      setAnimationsSuspended,
      setPollingActive,
    });

    expect(setAnimationsSuspended).toHaveBeenLastCalledWith(false);
    expect(setPollingActive).toHaveBeenLastCalledWith(true);

    suspended = true;
    for (const listener of listeners) listener();
    suspended = false;
    for (const listener of listeners) listener();

    expect(setAnimationsSuspended.mock.calls).toEqual([[false], [true], [false]]);
    expect(setPollingActive.mock.calls).toEqual([[true], [false], [true]]);
    dispose();
  });
});
