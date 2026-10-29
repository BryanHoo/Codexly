import type { AgentEvent, TaskEventModel } from "@codexly/protocol";
import { expectTypeOf, test } from "vitest";
import { runTaskEventReplayContract } from "@codexly/frontend-core/testing/task-event-replay";
import { createTaskStore } from "./task-store.js";

runTaskEventReplayContract(
  (initial) => createTaskStore({ projectId: "project", taskId: "task" }, initial),
  (store, sequence, provider) => {
    store.getState().applyEvents([
      {
        version: 2,
        provider,
        taskId: "task",
        turnId: "turn",
        itemId: "reasoning",
        sessionId: "session",
        timestamp: "2026-10-29T00:00:00.000Z",
        sequence,
        type: "reasoning.delta",
        payload: { delta: "公开摘要", field: "summary" },
      },
    ]);
  },
);

// 默认消费模型必须与公开协议等价，审批类型不能因泛型重绑定而放宽状态。
test("默认共享事件模型保留公开协议与审批判别", () => {
  expectTypeOf<AgentEvent>().toExtend<TaskEventModel>();
  expectTypeOf<TaskEventModel>().toExtend<AgentEvent>();
  expectTypeOf<
    Extract<TaskEventModel, { type: "pending_request.created" }>["payload"]["request"]["status"]
  >().toEqualTypeOf<"pending">();
});
