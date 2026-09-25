import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";

const baseSnapshot: AgentTaskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "session-1" },
  snapshot: {
    contextUsage: null,
    goal: null,
    id: "task-1",
    pendingRequests: [],
    pinned: false,
    plan: null,
    projectId: "project-1",
    settings: {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    },
    status: "running",
    title: "Context usage task",
    turns: [],
    turnsNextCursor: null,
    updatedAt: "2026-08-30T00:00:00.000Z",
  },
};

describe("TaskStore context usage reconciliation", () => {
  it("uses native snapshot usage instead of retaining a second frontend authority", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, baseSnapshot);
    const usageEvent: AgentEvent = {
      payload: { usage: { contextWindow: 200_000, usedTokens: 48_000 } },
      provider: "codex",
      sequence: 1,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-08-30T00:00:01.000Z",
      turnId: "turn-1",
      type: "usage.updated",
      version: 2,
    };

    store.getState().applyEvents([usageEvent]);
    store.getState().reconcile({
      checkpoint: { sequence: 1, sessionId: "session-1" },
      snapshot: {
        ...baseSnapshot.snapshot,
        contextUsage: { contextWindow: 200_000, usedTokens: 49_000 },
        status: "idle",
        updatedAt: "2026-08-30T00:00:02.000Z",
      },
    });

    expect(store.getState().snapshotMetadata?.contextUsage).toEqual({
      contextWindow: 200_000,
      usedTokens: 49_000,
    });

    store.getState().applyEvents([
      {
        ...usageEvent,
        payload: { usage: { contextWindow: 200_000, usedTokens: 62_000 } },
        sequence: 2,
        timestamp: "2026-08-30T00:00:03.000Z",
        turnId: "turn-2",
      },
    ]);

    expect(store.getState().snapshotMetadata?.contextUsage).toEqual({
      contextWindow: 200_000,
      usedTokens: 62_000,
    });
  });

  it("clears stale usage when the native projection no longer has it", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, {
      ...baseSnapshot,
      snapshot: {
        ...baseSnapshot.snapshot,
        contextUsage: { contextWindow: 200_000, usedTokens: 48_000 },
      },
    });
    store.getState().reconcile({
      ...baseSnapshot,
      checkpoint: { sequence: 1, sessionId: "session-1" },
    });
    expect(store.getState().snapshotMetadata?.contextUsage).toBeNull();
  });
});
