import { describe, expect, it, vi } from "vitest";
import { shallow } from "zustand/shallow";
import { createTaskStore } from "./task-store.js";
import { createInspectorTaskSelector, selectTaskRuntimeMetadata } from "./task-view-selectors.js";

function fixture() {
  return createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", status: "running",
      pinned: false, goal: null, plan: null, contextUsage: null,
      updatedAt: "2026-09-05T00:00:00Z", pendingRequests: [], turnsNextCursor: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "test", reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [{ id: "turn", status: "running", error: null, startedAt: "2026-09-05T00:00:00Z", completedAt: null, items: [
        { id: "answer", type: "message", role: "assistant", text: "" },
        { id: "user", type: "message", role: "user", text: "Hello" },
      ] }],
    },
  });
}

describe("task view subscriptions", () => {
  it("isolates 100 deltas without traversing or materializing loaded history", () => {
    const store = fixture();
    const selectInspector = createInspectorTaskSelector();
    const initial = selectInspector(store.getState());
    const metadata = selectTaskRuntimeMetadata(store.getState());
    const spies = [...store.getState().itemStoresByKey.values()].flatMap(item => [vi.spyOn(item, "peek"), vi.spyOn(item, "read")]);
    for (let sequence = 1; sequence <= 100; sequence++) {
      store.getState().applyEvents([{
        version: 2, provider: "codex", sessionId: "session", taskId: "task", turnId: "turn", itemId: "answer",
        sequence, timestamp: `2026-09-05T00:00:01.${sequence}Z`, type: "message.delta", payload: { delta: "x" },
      }]);
      expect(shallow(selectTaskRuntimeMetadata(store.getState()), metadata)).toBe(true);
      expect(selectInspector(store.getState())).toBe(initial);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(store.getState().getItem("answer", "turn")).toMatchObject({ text: "x".repeat(100) });
  });

  it("updates plan independently and rebuilds sources after snapshot replacement", () => {
    const store = fixture();
    const select = createInspectorTaskSelector();
    const initial = select(store.getState());
    const snapshot = store.getState().reconstructSnapshot()!;
    store.setState({ snapshotMetadata: { ...store.getState().snapshotMetadata!, plan: { explanation: "Next", steps: [] } } });
    expect(select(store.getState())?.plan).toEqual({ explanation: "Next", steps: [] });
    expect(select(store.getState())?.turns).toBe(initial?.turns);
    store.getState().hydrate({ checkpoint: { sequence: 1, sessionId: "session" }, snapshot: { ...snapshot, turns: [] } });
    expect(select(store.getState())?.turns).toEqual([]);
  });

  it("refreshes source items while ignoring completed assistant messages", () => {
    const store = fixture();
    const select = createInspectorTaskSelector();
    const initial = select(store.getState());
    const event = {
      version: 2 as const, provider: "codex" as const, sessionId: "session", taskId: "task", turnId: "turn",
      sequence: 1, timestamp: "2026-09-05T00:00:01Z", type: "item.completed" as const,
      itemId: "answer", payload: { item: { id: "answer", type: "message" as const, role: "assistant" as const, text: "Done" } },
    };
    store.getState().applyEvents([event]);
    expect(select(store.getState())).toBe(initial);
    store.getState().applyEvents([{ ...event, sequence: 2, itemId: "user", payload: { item: {
      id: "user", type: "message", role: "user", text: "Hello", skills: [{ name: "test" }],
    } } }]);
    expect(select(store.getState())?.turns[0]?.items[0]).toMatchObject({ skills: [{ name: "test" }] });
    expect(select(store.getState())).not.toBe(initial);
  });
});
