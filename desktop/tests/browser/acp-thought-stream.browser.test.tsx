import { expect, it } from "vitest";
import type { AgentItem } from "@codexly/protocol";
import { createTaskStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import {
  createResponse,
  eventEnvelope,
  timestamp,
} from "../../../apps/web/src/features/conversation/runtime/task-store.test-support.js";

it("ACP 公开思考通过真实 Web Store 逐段展示，完成快照保持相同文本", () => {
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
  const entry = { turnId: "turn-running", itemId: "acp:message:thought:thought" };
  const start = { id: entry.itemId, type: "reasoning", summary: "", content: "" } satisfies AgentItem;
  const readTurn = () =>
    store.getState().reconstructSnapshot()?.turns.find((turn) => turn.id === entry.turnId);
  const readThought = () => readTurn()?.items.find((item) => item.id === entry.itemId);

  // 从浏览器实际接收的公开事件开始验证，服务端投影由 event-projection.test.ts 验证。
  store.getState().applyEvents([
    { ...eventEnvelope(11), ...entry, type: "item.started", payload: { item: start } },
    {
      ...eventEnvelope(12),
      ...entry,
      type: "reasoning.delta",
      payload: { field: "summary", delta: "先检查" },
    },
  ]);
  expect(readThought()).toEqual({ ...start, summary: "先检查" });
  store.getState().applyEvents([
    {
      ...eventEnvelope(13),
      ...entry,
      type: "reasoning.delta",
      payload: { field: "summary", delta: "已有代码" },
    },
  ]);
  const completed = { ...start, summary: "先检查已有代码" };
  expect(readThought()).toEqual(completed);
  store.getState().applyEvents([
    { ...eventEnvelope(14), ...entry, type: "item.completed", payload: { item: completed } },
    {
      ...eventEnvelope(15),
      type: "turn.completed",
      turnId: entry.turnId,
      payload: {
        turn: {
          id: entry.turnId,
          status: "completed",
          stopReason: "end_turn",
          startedAt: timestamp,
          completedAt: eventEnvelope(15).timestamp,
          error: null,
          items: [completed],
        },
      },
    },
  ]);
  expect(readTurn()?.status).toBe("completed");
  expect(readThought()).toEqual(completed);
});
