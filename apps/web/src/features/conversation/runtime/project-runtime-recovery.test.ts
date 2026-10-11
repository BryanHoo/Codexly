import type { AgentEvent } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskEventTarget } from "./project-runtime-recovery.js";
import { createTurnCompletedEvent } from "./project-runtime.test-support.js";
import { createTaskStore } from "./task-store.js";

function createMessageDeltaEvent(sequence: number, delta: string): AgentEvent {
  return {
    itemId: "message-task-1",
    payload: { delta },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId: "task-1",
    timestamp: "2026-08-17T00:00:00.000Z",
    turnId: "turn-task-1",
    type: "message.delta",
    version: 2,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TaskEventTarget", () => {
  it.each(["dispose", "resetForSnapshot", "requestRecovery"] as const)(
    "%s 时取消后台提交并清理监听器",
    (operation) => {
      vi.useFakeTimers();
      const visibility = Object.assign(new EventTarget(), { visibilityState: "hidden" });
      vi.stubGlobal("document", visibility);
      const removeListener = vi.spyOn(visibility, "removeEventListener");
      const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
      const applyEvents = vi.spyOn(store.getState(), "applyEvents");
      const target = new TaskEventTarget(store, vi.fn(), vi.fn());
      target.apply(createMessageDeltaEvent(1, "首个"));
      target.apply(createMessageDeltaEvent(2, "取消"));
      target[operation]();
      expect(removeListener).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(16);
      expect(applyEvents).toHaveBeenCalledOnce();
      target.dispose();
    },
  );

  it("后台终态事件先提交积压 Delta，再应用终态并取消定时提交", () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const applyEvents = vi.spyOn(store.getState(), "applyEvents");
    const target = new TaskEventTarget(store, vi.fn(), vi.fn());
    const delta = createMessageDeltaEvent(2, "后续");
    const completed = createTurnCompletedEvent("task-1", 3);
    target.apply(createMessageDeltaEvent(1, "首个"));
    target.apply(delta);
    target.apply(completed);
    expect(applyEvents).toHaveBeenNthCalledWith(2, [delta]);
    expect(applyEvents).toHaveBeenNthCalledWith(3, [completed]);
    vi.advanceTimersByTime(16);
    expect(applyEvents).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    target.dispose();
  });

  it("后台 rAF 停止时持续提交 Delta，不因跨批次积压触发快照恢复", () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const applyEvents = vi.spyOn(store.getState(), "applyEvents");
    const recoverSnapshot = vi.fn();
    const target = new TaskEventTarget(store, recoverSnapshot, vi.fn());
    // 累计输出超过 1 MiB 缓冲上限，但每个调度批次均可及时消费。
    const delta = "x".repeat(128 * 1024);
    for (let sequence = 1; sequence <= 12; sequence += 2) {
      target.apply(createMessageDeltaEvent(sequence, delta));
      target.apply(createMessageDeltaEvent(sequence + 1, delta));
      vi.advanceTimersByTime(16);
    }
    expect(recoverSnapshot).not.toHaveBeenCalled();
    expect(applyEvents).toHaveBeenCalledTimes(12);
    expect(applyEvents).toHaveBeenLastCalledWith([createMessageDeltaEvent(12, delta)]);
    target.dispose();
  });

  it("切入后台后替换已排队的 rAF，恢复前台时不重复提交", () => {
    vi.useFakeTimers();
    const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", documentTarget);
    let frameCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const applyEvents = vi.spyOn(store.getState(), "applyEvents");
    const target = new TaskEventTarget(store, vi.fn(), vi.fn());
    target.apply(createMessageDeltaEvent(1, "首个"));
    target.apply(createMessageDeltaEvent(2, "后续"));

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(cancelFrame).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(16);
    expect(applyEvents).toHaveBeenCalledTimes(2);
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    frameCallback?.(0);
    expect(applyEvents).toHaveBeenCalledTimes(2);
    target.dispose();
  });

  it("applies the first delta immediately and batches subsequent deltas until the next frame", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const applyEvents = vi.spyOn(store.getState(), "applyEvents");
    const target = new TaskEventTarget(store, vi.fn(), vi.fn());
    const firstDelta = createMessageDeltaEvent(1, "首个");
    const subsequentDelta = createMessageDeltaEvent(2, "后续");
    let frameCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    target.apply(firstDelta);
    expect(applyEvents).toHaveBeenCalledOnce();
    expect(applyEvents).toHaveBeenLastCalledWith([firstDelta]);

    target.apply(subsequentDelta);
    expect(applyEvents).toHaveBeenCalledOnce();

    expect(frameCallback).toBeDefined();
    frameCallback?.(0);
    expect(applyEvents).toHaveBeenCalledTimes(2);
    expect(applyEvents).toHaveBeenLastCalledWith([subsequentDelta]);
    target.dispose();
  });
});
