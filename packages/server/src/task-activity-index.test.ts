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

test("异步问题将任务标为待输入，运行事件不会覆盖等待状态", () => {
  const index = new TaskActivityIndex();
  index.observe("p", {
    type: "item.completed",
    taskId: "t",
    turnId: "turn",
    itemId: "q",
    payload: {
      item: {
        id: "q",
        type: "message",
        role: "assistant",
        text: "请选择",
        questions: [{ title: "运行方式", options: [] }],
      },
    },
  });
  expect(index.snapshot()[0]).toMatchObject({ status: "waiting", requiresApproval: false });
  index.observe("p", { type: "task.status_updated", taskId: "t", payload: { status: "running" } });
  expect(index.snapshot()[0]?.status).toBe("waiting");
});

test("问题与审批并存时保留两种等待事实，关闭问题不能清除审批", () => {
  const index = new TaskActivityIndex();
  index.observe("p", {
    type: "pending_request.created",
    taskId: "t",
    payload: { request: { requestId: "approval", type: "command_approval" } },
  } as never);
  index.observe("p", {
    type: "item.completed",
    taskId: "t",
    turnId: "turn",
    itemId: "q",
    payload: {
      item: {
        id: "q",
        type: "message",
        role: "assistant",
        text: "请选择",
        questions: [{ title: "范围", options: [] }],
      },
    },
  });
  expect(index.setAsyncPending("p", "t", false)).toBe(false);
  expect(index.snapshot()[0]).toMatchObject({ status: "waiting", requiresApproval: true });
  index.setAsyncPending("p", "t", true);
  index.observe("p", {
    type: "pending_request.resolved",
    taskId: "t",
    payload: { request: { requestId: "approval" } },
  } as never);
  expect(index.snapshot()[0]).toMatchObject({ status: "waiting", requiresApproval: false });
  expect(index.setAsyncPending("p", "t", false)).toBe(true);
  expect(index.snapshot()[0]?.status).toBe("running");
});
