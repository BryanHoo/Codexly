import type { AgentEvent } from "@code-agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskEventTarget } from "./project-runtime-recovery.js";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TaskEventTarget", () => {
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
