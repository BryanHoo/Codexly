import { expect, test } from "vitest";
import { createTaskStore } from "./task-store.js";
import { selectTaskRuntimeMetadata } from "@codexly/frontend-core/task-view-selectors";

const response = {
  checkpoint: { sequence: 7, sessionId: "s" },
  snapshot: {
    runtime: "acp" as const,
    engine: "claude" as const,
    id: "t",
    projectId: "p",
    title: "历史",
    pinned: false,
    updatedAt: "2026-11-10T00:00:00Z",
    status: "idle" as const,
    goal: null,
    plan: null,
    contextUsage: null,
    pendingRequests: [],
    turns: [],
    turnsNextCursor: "older",
  },
};
test("ACP 历史重建和元数据保留运行时身份，迟到旧设置不能污染配置", () => {
  const store = createTaskStore({ projectId: "p", taskId: "t" }, response);
  expect(store.getState().reconstructSnapshot()).toEqual(response.snapshot);
  expect(selectTaskRuntimeMetadata(store.getState())).toMatchObject({
    runtime: "acp",
    engine: "claude",
  });
  store.getState().setTaskSettings({
    model: "legacy",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    reasoningEffort: "",
    sandboxMode: "read-only",
  });
  expect(store.getState().reconstructSnapshot()).not.toHaveProperty("settings");
  expect(selectTaskRuntimeMetadata(store.getState())).not.toHaveProperty("settings");
  expect(store.getState().reconstructSnapshot()?.turnsNextCursor).toBe("older");
});

test("ACP 历史续页保留身份，续聊增量只更新新回合", () => {
  const turn = (id: string) => ({
    id,
    status: "completed" as const,
    startedAt: null,
    completedAt: null,
    error: null,
    items: [
      {
        id: `message-${id}`,
        type: "message" as const,
        role: "assistant" as const,
        text: `历史-${id}`,
      },
    ],
  });
  const store = createTaskStore(
    { projectId: "p", taskId: "t" },
    { ...response, snapshot: { ...response.snapshot, turns: [turn("recent")] } },
  );
  store.getState().prependHistory({
    ...response,
    snapshot: { ...response.snapshot, turns: [turn("older")], turnsNextCursor: null },
  });
  const base = {
    version: 2 as const,
    provider: "claude",
    projectId: "p",
    taskId: "t",
    sessionId: "s",
    turnId: "next",
    timestamp: "2026-11-10T00:01:00Z",
  };
  store.getState().applyEvents([
    {
      ...base,
      sequence: 8,
      type: "turn.started",
      payload: { turn: { ...turn("next"), status: "running", items: [] } },
    },
    {
      ...base,
      sequence: 9,
      type: "message.delta",
      itemId: "reply",
      payload: { delta: "续聊正文" },
    },
  ]);
  expect(store.getState().turnIds).toEqual(["older", "recent", "next"]);
  expect(store.getState().getItem("message-older", "older")).toMatchObject({ text: "历史-older" });
  expect(store.getState().getItem("reply", "next")).toMatchObject({ text: "续聊正文" });
  expect(store.getState().reconstructSnapshot()).toMatchObject({
    runtime: "acp",
    turnsNextCursor: null,
  });
  expect(store.getState().reconstructSnapshot()).not.toHaveProperty("settings");
});
