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

test("does not infer a skill merge between separate server user messages", () => {
  const store = makeStore();
  const user = { ...item("user", "$check\n继续"), role: "user" as const };
  store.getState().applyEvents([
    {
      ...eventEnvelope(11),
      type: "item.completed",
      turnId: "turn-running",
      itemId: "user",
      payload: { item: user },
    },
    {
      ...eventEnvelope(12),
      type: "item.completed",
      turnId: "turn-running",
      itemId: "skill",
      payload: { item: { ...user, id: "skill", text: "", skills: [{ name: "check" }] } },
    },
  ]);
  expect(readTurnItemIds(store, "turn-running")).toEqual(["old", "user", "skill"]);
  expect(store.getState().getItem("user", "turn-running")).toMatchObject({ text: "$check\n继续" });
});

test("applies a server-provided alias without comparing message content", () => {
  const store = makeStore();
  store.getState().reconcile(response([item("canonical", "权威内容", ["old"])]));
  expect(readTurnItemIds(store, "turn-running")).toEqual(["canonical"]);
  expect(store.getState().getItem("canonical", "turn-running")).toMatchObject({ text: "权威内容" });
});

test.each(["running", "completed"] as const)(
  "replaces a restored async answer when native history takes over (%s)",
  (status) => {
    const question = item("question", "请选择范围");
    const answer = { ...item("persisted-answer", "范围\n整个项目"), role: "user" as const };
    const turn = response([]).snapshot.turns[0];
    if (turn === undefined) throw new Error("Missing turn fixture");
    const restored = createResponse({
      turns: [{ ...turn, status, items: [question, answer] }],
    });
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, restored);
    const native = {
      ...restored,
      snapshot: {
        ...restored.snapshot,
        turns: restored.snapshot.turns.map((turn) => ({
          ...turn,
          items: [question, { ...answer, id: "native-answer", identityAliases: [answer.id] }],
        })),
      },
    };
    // 重复恢复历史仍须只显示一次，且清理已被接管的补位实体。
    store.getState().reconcile(native);
    store.getState().reconcile(native);
    expect(readTurnItemIds(store, "turn-running")).toEqual([question.id, "native-answer"]);
    expect(store.getState().getItem(answer.id, "turn-running")).toBeUndefined();
  },
);

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
