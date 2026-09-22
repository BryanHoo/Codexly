import { describe, expect, it } from "vitest";
import { createTaskStore } from "./task-store.js";
import { createResponse, eventEnvelope } from "./task-store.test-support.js";

describe("task store notices", () => {
  it("clears runtime warnings when assistant streaming resumes", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          code: "runtime_warning",
          level: "warning",
          message: "Runtime warning after context compaction",
        },
        type: "task.notice",
      },
      {
        ...eventEnvelope(12),
        payload: {
          code: "strict_review_required",
          level: "warning",
          message: "Strict review remains active",
        },
        type: "task.notice",
      },
      {
        ...eventEnvelope(13),
        itemId: "message-running",
        payload: { delta: "继续处理当前任务。" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);

    expect(store.getState().notices).toMatchObject([
      {
        payload: {
          code: "strict_review_required",
          message: "Strict review remains active",
        },
      },
    ]);
  });
});
