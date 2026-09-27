import { describe, expect, it } from "vitest";
import { createTaskStore } from "./task-store.js";
import { createResponse, eventEnvelope } from "./task-store.test-support.js";

describe("task store notices", () => {
  it("retains runtime warnings alongside other notices", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: { code: "runtime_warning", level: "warning", message: "Hidden warning" },
        type: "task.notice",
      },
      {
        ...eventEnvelope(12),
        payload: { code: "strict_review_required", level: "warning", message: "Review required" },
        type: "task.notice",
      },
    ]);

    expect(store.getState().notices.map((notice) => notice.payload.code)).toEqual([
      "runtime_warning",
      "strict_review_required",
    ]);
    expect(store.getState().checkpoint?.sequence).toBe(12);
  });
});
