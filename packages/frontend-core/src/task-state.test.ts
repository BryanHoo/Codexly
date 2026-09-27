import { describe, expect, it, vi } from "vitest";
import {
  acceptTaskEvent,
  createTaskStoreRegistry,
  retainPendingRequest,
  touchedCommandOutputItemKeys,
} from "./task-state.js";

describe("shared task state", () => {
  it("rejects replayed, foreign, and previous-session events", () => {
    const checkpoint = { sessionId: "current", sequence: 5 };
    expect(
      acceptTaskEvent("task", checkpoint, { taskId: "task", sessionId: "current", sequence: 6 }),
    ).toBe(true);
    expect(
      acceptTaskEvent("task", checkpoint, { taskId: "task", sessionId: "current", sequence: 5 }),
    ).toBe(false);
    expect(
      acceptTaskEvent("task", checkpoint, { taskId: "other", sessionId: "current", sequence: 6 }),
    ).toBe(false);
    expect(
      acceptTaskEvent("task", checkpoint, { taskId: "task", sessionId: "old", sequence: 6 }),
    ).toBe(false);
    expect(
      acceptTaskEvent("task", null, { taskId: "task", sessionId: "current", sequence: 6 }),
    ).toBe(false);
  });
  it("retains active requests while bounding terminal requests by completion order", () => {
    let state: {
      pendingRequestIds: readonly string[];
      pendingRequestsById: Record<string, { requestId: string; status: string }>;
    } = { pendingRequestIds: [], pendingRequestsById: {} };
    for (let index = 0; index < 22; index += 1) {
      state = retainPendingRequest(state, { requestId: String(index), status: "resolved" });
    }
    state = retainPendingRequest(state, { requestId: "active", status: "pending" });
    state = retainPendingRequest(state, { requestId: "2", status: "resolved" });
    expect(state.pendingRequestIds).toEqual([
      ...Array.from({ length: 19 }, (_, index) => String(index + 3)),
      "active",
      "2",
    ]);
  });

  it("evicts idle stores by byte budget without evicting active consumers", () => {
    const onEvict = vi.fn();
    const registry = createTaskStoreRegistry({
      createStore: () => ({ getState: () => ({ retainedBytes: 6 }) }),
      maxRetainedBytes: 10,
      onEvict,
    });
    const active = registry.acquire("p", "active");
    registry.acquire("p", "old");
    registry.release("p", "old");
    registry.acquire("p", "new");
    registry.release("p", "new");
    expect(registry.peek("p", "old")).toBeUndefined();
    expect(registry.peek("p", "active")).toBe(active);
    expect(registry.retainedBytes).toBe(6);
    expect(onEvict).toHaveBeenCalledTimes(1);
  });

  it("tracks output keys changed by replayed turn and item events", () => {
    const state = {
      itemKeysByTurnId: { turn: ['["turn","old"]'] },
      commandOutputBytesByItemKey: new Map<string, number>(),
    };
    const next = { ...state, itemKeysByTurnId: { turn: ['["turn","new"]'] } };
    expect(
      touchedCommandOutputItemKeys(state, next, { type: "turn.completed", turnId: "turn" }),
    ).toEqual(['["turn","old"]', '["turn","new"]']);
  });
});
