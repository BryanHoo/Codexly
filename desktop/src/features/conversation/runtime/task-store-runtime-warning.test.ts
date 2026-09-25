import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";
import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";

import { createTaskStore } from "./task-store.js";

const timestamp = "2026-09-23T00:00:00Z";
const response: AgentTaskSnapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "session" },
  snapshot: {
    id: "task", projectId: "project", title: "Task", pinned: false,
    updatedAt: timestamp, status: "running", pendingRequests: [],
    turns: [{ id: "turn", status: "running", startedAt: timestamp, completedAt: null, error: null, items: [] }],
    turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
    settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
      reasoningEffort: "high", sandboxMode: "workspace-write" },
  },
};

const eventBase = {
  version: 2, provider: "codex", taskId: "task", sessionId: "session", timestamp,
} as const;

function warning(sequence: number, code: "runtime_warning" | "model_verification" | "guardian_warning"): AgentEvent {
  return {
    ...eventBase, sequence, type: "task.notice",
    payload: { code, level: "warning", message: code },
  };
}

describe("runtime warning lifetime", () => {
  it.each([
    { type: "message.delta", itemId: "reply", payload: { text: "继续" } },
    { type: "plan.delta", itemId: "plan", payload: { text: "继续" } },
    { type: "command.output_delta", itemId: "command", payload: { delta: "继续" } },
  ] as const)("keeps runtime warnings after $type", (output) => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning"), warning(2, "model_verification")]);
    expect(store.getState().notices).toHaveLength(2);

    store.getState().applyEvents([{ ...eventBase, ...output, turnId: "turn", sequence: 3 } as AgentEvent]);

    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual(["runtime_warning", "model_verification"]);
  });

  it.each(["idle", "failed"] as const)("keeps runtime warnings when task becomes %s", (status) => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning"), warning(2, "model_verification")]);

    store.getState().applyEvents([{
      ...eventBase, sequence: 3, type: "task.status_updated", payload: { status },
    }]);

    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual(["runtime_warning", "model_verification"]);
  });

  it("keeps all warnings when the turn completes", () => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning"), warning(2, "model_verification"), warning(3, "guardian_warning")]);
    store.getState().applyEvents([{
      ...eventBase, sequence: 4, type: "turn.completed", turnId: "turn",
      payload: { turn: { ...response.snapshot.turns[0]!, status: "interrupted", completedAt: timestamp } },
    }]);
    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual(["runtime_warning", "model_verification", "guardian_warning"]);
  });

  it("keeps previous warnings when a new turn starts", () => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning"), warning(2, "model_verification")]);
    store.getState().applyEvents([{
      ...eventBase, sequence: 3, type: "turn.started", turnId: "next-turn",
      payload: { turn: { ...response.snapshot.turns[0]!, id: "next-turn" } },
    }]);
    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual(["runtime_warning", "model_verification"]);
  });

  it("keeps every warning beyond the old notice limit", () => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents(Array.from({ length: 25 }, (_, index) => warning(index + 1, "runtime_warning")));
    expect(store.getState().notices).toHaveLength(25);
  });

  it.each(["hydrate", "reconcile"] as const)("preserves warnings and their memory budget during %s", (operation) => {
    const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
    store.getState().applyEvents([warning(1, "runtime_warning")]);
    const baseline = createTaskStore({ projectId: "project", taskId: "task" }, response);

    store.getState()[operation](response);

    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().retainedBytes).toBe(
      baseline.getState().retainedBytes + estimateRetainedBytes(store.getState().notices[0]),
    );
  });
});
