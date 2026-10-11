import type { AgentTaskSnapshotResponse, AgentTurn } from "@/protocol/index.js";
import { expect, it, vi } from "vitest";
import { createTaskStore } from "./task-store.js";

it("prepends item pages within an existing turn without reading or replacing live stores", () => {
  const message = (id: string, text = id) => ({ id, text, role: "assistant" as const, type: "message" as const });
  const turn: AgentTurn = { id: "turn", status: "running", error: null, startedAt: null, completedAt: null, items: [message("newest", "实时正文")], itemTimings: { newest: { startedAtMs: 100 } } };
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sequence: 1, sessionId: "session" },
    snapshot: { id: "task", projectId: "project", title: "历史", settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" }, status: "running", pinned: false, contextUsage: null, goal: null, plan: null, pendingRequests: [], updatedAt: "2026-10-11T00:00:00Z", turns: [turn], turnsNextCursor: "items-next" },
  };
  const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
  const liveStore = [...store.getState().itemStoresByKey.values()][0];
  if (liveStore === undefined) throw new Error("Expected the live Item store");
  const read = vi.spyOn(liveStore, "read");
  const before = store.getState().retainedBytes;
  const page = { ...response, snapshot: { ...response.snapshot, turnsNextCursor: null, turns: [{ ...turn, status: "completed" as const, items: [message("older"), message("newest", "过时正文")], itemTimings: { older: { startedAtMs: 1 } } }] } };
  store.getState().prependHistory(page);
  expect(read).not.toHaveBeenCalled();
  expect([...store.getState().itemStoresByKey.values()]).toContain(liveStore);
  expect(store.getState().retainedBytes).toBeGreaterThan(before);
  expect(store.getState().reconstructSnapshot()).toMatchObject({ turns: [{ status: "running", items: [message("older"), message("newest", "实时正文")], itemTimings: { older: { startedAtMs: 1 }, newest: { startedAtMs: 100 } } }], turnsNextCursor: null });
  const after = store.getState().retainedBytes;
  store.getState().prependHistory(page);
  expect(store.getState().itemStoresByKey.size).toBe(2);
  expect(store.getState().retainedBytes).toBe(after);
});
