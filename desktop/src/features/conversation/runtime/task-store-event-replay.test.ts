import { runTaskEventReplayContract } from "@codexly/frontend-core/testing/task-event-replay";
import { createTaskStore } from "./task-store.js";

runTaskEventReplayContract(
  (initial) => createTaskStore({ projectId: "project", taskId: "task" }, initial),
  // 原生层只交付公开摘要；消费契约不要求把原始推理内容带入 WebView。
  (store, sequence, provider) =>
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
        payload: { delta: "公开摘要" },
      },
    ]),
);
