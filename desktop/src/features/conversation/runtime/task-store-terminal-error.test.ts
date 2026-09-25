import type { AgentTaskSnapshotResponse, AgentTurn } from "@/protocol/index.js";
import { expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";

it.each([null, "native failure"])("uses the native terminal error %s without frontend fallback", (error) => {
  const turn: AgentTurn = {
    id: "turn", status: "failed", error: "stale frontend failure",
    startedAt: null, completedAt: null, items: [],
  };
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-09-12T00:00:00Z", status: "failed", pendingRequests: [],
      turns: [turn], turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
    },
  };
  const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
  store.getState().applyEvents([{
    version: 2, provider: "codex", taskId: "task", turnId: "turn",
    sessionId: "session", sequence: 1, timestamp: response.snapshot.updatedAt,
    type: "turn.completed", payload: { turn: { ...turn, error } },
  }]);
  expect(store.getState().reconstructSnapshot()?.turns[0]?.error).toBe(error);
});
