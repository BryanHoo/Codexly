import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";

import type { DetailViewUpdateGate } from "../../../shared/lifecycle/application-visibility.js";
import type { TaskStore } from "./task-store.js";
import { TaskEventTarget } from "./project-runtime-recovery.js";

class FakeUpdateGate implements DetailViewUpdateGate {
  readonly #listeners = new Set<() => void>();
  #suspended = true;

  public isSuspended(): boolean {
    return this.#suspended;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public resume(): void {
    this.#suspended = false;
    for (const listener of this.#listeners) listener();
  }
}

function createEvent(sequence: number, delta: string): AgentEvent {
  return {
    itemId: "item-1",
    payload: { delta },
    provider: "codex",
    sequence,
    sessionId: "session-1",
    taskId: "task-1",
    timestamp: "2026-08-29T00:00:00.000Z",
    turnId: "turn-1",
    type: "message.delta",
    version: 2,
  };
}

describe("TaskEventTarget 后台暂停", () => {
  it("暂停期间不更新详细 Store，并在恢复时单次提交合并事件", () => {
    const applyEvents = vi.fn();
    const state = {
      applyEvents,
      checkpoint: { sequence: 0, sessionId: "session-1" },
      setConnectionState: vi.fn(),
      setError: vi.fn(),
      taskId: "task-1",
    };
    const store = { getState: () => state } as unknown as TaskStore;
    const gate = new FakeUpdateGate();
    const target = new TaskEventTarget(store, vi.fn(), vi.fn(), gate);

    target.apply(createEvent(1, "hello "));
    target.apply(createEvent(2, "world"));
    expect(applyEvents).not.toHaveBeenCalled();

    gate.resume();
    expect(applyEvents).toHaveBeenCalledTimes(1);
    expect(applyEvents.mock.calls[0]?.[0]).toMatchObject([
      { payload: { delta: "hello world" }, sequence: 2 },
    ]);

    target.dispose();
  });

  it("暂停期间延迟 Snapshot 对账和连接状态更新", () => {
    const reconcile = vi.fn();
    const setConnectionState = vi.fn();
    const state = {
      applyEvents: vi.fn(),
      checkpoint: { sequence: 0, sessionId: "session-1" },
      reconcile,
      setConnectionState,
      setError: vi.fn(),
      taskId: "task-1",
    };
    const store = { getState: () => state } as unknown as TaskStore;
    const gate = new FakeUpdateGate();
    const target = new TaskEventTarget(store, vi.fn(), vi.fn(), gate);
    const response = {
      checkpoint: { sequence: 4, sessionId: "session-1" },
      snapshot: { id: "task-1", projectId: "project-1" },
    } as AgentTaskSnapshotResponse;

    target.apply(createEvent(3, "before snapshot"));
    target.reconcileSnapshot(response);
    target.apply(createEvent(5, "after snapshot"));
    target.setConnectionState("connected");
    expect(reconcile).not.toHaveBeenCalled();
    expect(setConnectionState).not.toHaveBeenCalled();

    gate.resume();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(setConnectionState).toHaveBeenCalledWith("connected");
    expect(state.applyEvents).toHaveBeenCalledWith([
      expect.objectContaining({ payload: { delta: "after snapshot" }, sequence: 5 }),
    ]);

    target.dispose();
  });
});
