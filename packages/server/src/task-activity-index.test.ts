import { expect, test, vi } from "vitest";
import { TaskActivityIndex } from "./task-activity-index.js";

test("settles an active task on authoritative idle and preserves an existing failure", () => {
  const index = new TaskActivityIndex();
  index.observe("p", { type: "task.status_updated", taskId: "t", payload: { status: "running" } });
  expect(index.hasActiveProject("p")).toBe(true);
  index.observe("p", { type: "task.status_updated", taskId: "t", payload: { status: "idle" } });
  expect(index.hasActiveProject("p")).toBe(false);
  expect(index.snapshot()[0]?.status).toBe("completed");
  index.observe("p", { type: "task.status_updated", taskId: "t", payload: { status: "failed" } });
  index.observe("p", { type: "task.status_updated", taskId: "t", payload: { status: "idle" } });
  expect(index.snapshot()[0]?.status).toBe("failed");
});

test("ignores streamed tokens without allocating checkpoints or activities", () => {
  const index = new TaskActivityIndex(),
    checkpoint = vi.fn();
  for (let i = 0; i < 1000; i += 1)
    index.observe(
      "p",
      { type: "message.delta", taskId: "t", turnId: "turn", itemId: "i", payload: { delta: "x" } },
      checkpoint,
    );
  expect(checkpoint).not.toHaveBeenCalled();
  expect(index.snapshot()).toEqual([]);
});
