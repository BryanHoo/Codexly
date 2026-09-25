import type { AgentTaskSnapshot, AgentTurn } from "@/protocol/index.js";
import { expect, it } from "vitest";

import { createTaskItemKey, createTaskStore } from "./task-store.js";

it("延迟到达的 turn.started 不清空已经显示的提交消息", () => {
  const turn: AgentTurn = {
    id: "turn", status: "running", startedAt: "2026-09-12T00:00:00Z",
    completedAt: null, error: null,
    items: [{ id: "submitted-user-turn", type: "message", role: "user", text: "继续回答" }],
  };
  const snapshot: AgentTaskSnapshot = {
    id: "task", projectId: "project", title: "任务", pinned: false,
    updatedAt: turn.startedAt!, status: "running", pendingRequests: [], turns: [turn],
    turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
    settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
      reasoningEffort: "high", sandboxMode: "workspace-write" },
  };
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sessionId: "session", sequence: 0 }, snapshot,
  });
  const itemKey = createTaskItemKey(turn.id, "submitted-user-turn");
  const originalItemStore = store.getState().itemStoresByKey.get(itemKey);
  // 提交响应与实时事件是两条链路；空启动事件不能撤销已确认的本地展示。
  store.getState().applyEvents([{
    version: 2, provider: "codex", taskId: "task", turnId: turn.id,
    sessionId: "session", sequence: 1, timestamp: turn.startedAt!,
    type: "turn.started", payload: { turn: { ...turn, items: [] } },
  }]);
  expect(store.getState().itemKeysByTurnId[turn.id]).toEqual([itemKey]);
  expect(store.getState().itemStoresByKey.get(itemKey)).toBe(originalItemStore);
  expect(store.getState().reconstructSnapshot()?.turns[0]?.items[0]).toEqual(turn.items[0]);
  const assistantItem = { id: "assistant", type: "message", role: "assistant", text: "正在处理" } as const;
  store.getState().applyEvents([{
    version: 2, provider: "codex", taskId: "task", turnId: turn.id, itemId: assistantItem.id,
    sessionId: "session", sequence: 2, timestamp: turn.startedAt!,
    type: "item.started", payload: { item: assistantItem },
  }]);
  const userItem = { id: "authoritative-user", type: "message", role: "user", text: "继续回答" } as const;
  store.getState().applyEvents([{
    version: 2, provider: "codex", taskId: "task", turnId: turn.id, itemId: userItem.id,
    sessionId: "session", sequence: 3, timestamp: turn.startedAt!,
    type: "item.started", payload: { item: userItem },
  }]);
  expect(store.getState().reconstructSnapshot()?.turns[0]?.items).toEqual([userItem, assistantItem]);
  expect(store.getState().itemStoresByKey.has(itemKey)).toBe(false);
});
