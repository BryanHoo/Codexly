import { describe, expect, it } from "vitest";

import { TaskRuntimeState } from "./task-runtime-state.js";

describe("TaskRuntimeState", () => {
  it("clears every owned task-scoped collection together", () => {
    const state = new TaskRuntimeState();
    state.projectTaskIds.add("task-1");
    state.resumedTaskIds.add("task-1");
    state.runningTaskIds.add("task-1");
    state.activeReviewTurnIds.set("task-1", "review-turn");
    state.activeReviewWorkerTaskIds.add("task-1");
    state.reviewWorkerOutputTaskIds.add("task-1");
    state.reviewWorkerTaskIds.set("task-1", "reviewer-thread");
    state.reviewWorkerTurnIds.set("task-1", "reviewer-turn");
    state.reviewWorkerParentTaskIds.set("reviewer-thread", "task-1");
    state.contextUsage.set("task-1", { contextWindow: 100, usedTokens: 10 });
    expect(state).toHaveProperty("plans");
    if (!("plans" in state) || !(state.plans instanceof Map)) {
      return;
    }
    state.plans.set("task-1", {
      explanation: null,
      steps: [{ status: "pending", text: "执行验证" }],
    });
    state.mcpServerStatuses.set(
      "task-1",
      new Map([["fast-context", { error: null, failureReason: null, status: "ready" }]]),
    );
    state.mcpServerNames.set("task-1", new Set(["fast-context"]));
    state.unmaterializedTasks.set("task-1", {
      id: "task-1",
      pinned: false,
      projectId: "project-1",
      title: "Task",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });

    state.clearTask("task-1");

    expect(state.projectTaskIds.has("task-1")).toBe(false);
    expect(state.resumedTaskIds.has("task-1")).toBe(false);
    expect(state.runningTaskIds.has("task-1")).toBe(false);
    expect(state.activeReviewTurnIds.has("task-1")).toBe(false);
    expect(state.activeReviewWorkerTaskIds.has("task-1")).toBe(false);
    expect(state.reviewWorkerOutputTaskIds.has("task-1")).toBe(false);
    expect(state.reviewWorkerTaskIds.has("task-1")).toBe(false);
    expect(state.reviewWorkerTurnIds.has("task-1")).toBe(false);
    expect(state.reviewWorkerParentTaskIds.has("reviewer-thread")).toBe(false);
    expect(state.contextUsage.has("task-1")).toBe(false);
    expect(state.plans.has("task-1")).toBe(false);
    expect(state.mcpServerStatuses.has("task-1")).toBe(false);
    expect(state.mcpServerNames.has("task-1")).toBe(false);
    expect(state.unmaterializedTasks.has("task-1")).toBe(false);
  });
});
