import { expect, test } from "vitest";
import { createTaskStore } from "./task-store.js";
import {
  createResponse,
  eventEnvelope,
  readTurnItemIds,
  timestamp,
} from "./task-store.test-support.js";

const item = (id: string, text: string, identityAliases?: string[]) => ({
  id,
  text,
  role: "assistant" as const,
  type: "message" as const,
  ...(identityAliases === undefined ? {} : { identityAliases }),
});
const response = (items: ReturnType<typeof item>[]) =>
  createResponse({
    turns: [
      {
        id: "turn-running",
        items,
        status: "running",
        startedAt: timestamp,
        completedAt: null,
        error: null,
      },
    ],
  });
const makeStore = () =>
  createTaskStore({ projectId: "project-1", taskId: "task-1" }, response([item("old", "正文")]));

test("keeps different identities distinct even when message text matches", () => {
  const store = makeStore();
  store.getState().reconcile(response([item("new", "正文扩展")]));
  expect(readTurnItemIds(store, "turn-running")).toEqual(["old", "new"]);
});

test("applies a server-provided alias without comparing message content", () => {
  const store = makeStore();
  store.getState().reconcile(response([item("canonical", "权威内容", ["old"])]));
  expect(readTurnItemIds(store, "turn-running")).toEqual(["canonical"]);
  expect(store.getState().getItem("canonical", "turn-running")).toMatchObject({ text: "权威内容" });
});

test("removes an already rendered alias when item completion announces its canonical identity", () => {
  const store = makeStore();
  store.getState().applyEvents([
    {
      ...eventEnvelope(11),
      type: "item.completed",
      turnId: "turn-running",
      itemId: "canonical",
      payload: { item: item("canonical", "最终内容", ["old"]) },
    },
  ]);
  expect(readTurnItemIds(store, "turn-running")).toEqual(["canonical"]);
  expect(store.getState().getItem("old", "turn-running")).toBeUndefined();
});

test("uses a fresh authoritative snapshot after the server event session changes", () => {
  const store = makeStore();
  store.getState().reconcile({
    ...response([item("fresh", "正文")]),
    checkpoint: { sessionId: "restarted-server", sequence: 0 },
  });
  expect(readTurnItemIds(store, "turn-running")).toEqual(["fresh"]);
});

test("applies aliases carried by terminal turns without retaining duplicate items", () => {
  const store = makeStore();
  const terminal = response([item("canonical", "完成", ["old"])]).snapshot.turns[0];
  if (terminal === undefined) throw new Error("Missing turn fixture");
  store.getState().applyEvents([
    {
      ...eventEnvelope(11),
      type: "turn.completed",
      turnId: "turn-running",
      payload: { turn: { ...terminal, status: "completed" } },
    },
  ]);
  expect(readTurnItemIds(store, "turn-running")).toEqual(["canonical"]);
  expect(store.getState().getItem("old", "turn-running")).toBeUndefined();
});
