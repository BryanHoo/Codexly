import { expect, test } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { MessageIdentityRegistry } from "./message-identity.js";

const message = (id: string, text: string) => ({
  id,
  text,
  role: "assistant" as const,
  type: "message" as const,
});
const turn = (items: AgentTurn["items"]): AgentTurn => ({
  id: "turn",
  items,
  startedAt: null,
  completedAt: null,
  error: null,
  status: "running",
});
const delta = (id: string, text: string) => ({
  type: "message.delta" as const,
  taskId: "task",
  turnId: "turn",
  itemId: id,
  payload: { delta: text },
});
const complete = (id: string, text: string) => ({
  type: "item.completed" as const,
  taskId: "task",
  turnId: "turn",
  itemId: id,
  payload: { item: message(id, text) },
});

test("normalizes snapshots to a streamed identity and keeps subsequent deltas on that identity", () => {
  const registry = new MessageIdentityRegistry();
  registry.event(delta("live", "正在"));
  const snapshot = registry.snapshot("task", [turn([message("snapshot", "正在处理")])]);
  expect(snapshot[0]?.items).toEqual([
    { ...message("live", "正在处理"), identityAliases: ["snapshot"] },
  ]);
  expect(registry.event(complete("live", "正在处理完成"))).toMatchObject({
    itemId: "live",
    payload: { item: { id: "live", identityAliases: ["snapshot"] } },
  });
});

test("announces a late alias when a snapshot was seen before streamed completion", () => {
  const registry = new MessageIdentityRegistry();
  registry.snapshot("task", [turn([message("snapshot", "正在处理")])]);
  registry.event(delta("live", "处理"));
  expect(registry.event(complete("live", "正在处理完成"))).toMatchObject({
    itemId: "snapshot",
    payload: { item: { id: "snapshot", identityAliases: ["live"] } },
  });
  expect(registry.event(delta("live", "。"))).toMatchObject({ itemId: "snapshot" });
});

test("never merges repeated live messages or ambiguous snapshot candidates", () => {
  const registry = new MessageIdentityRegistry();
  registry.event(complete("live-1", "重复"));
  registry.event(complete("live-2", "重复"));
  const snapshot = registry.snapshot("task", [turn([message("snapshot", "重复内容")])]);
  expect(snapshot[0]?.items).toEqual([message("snapshot", "重复内容")]);
});

test("requires unique matching on both sides of a snapshot batch", () => {
  const registry = new MessageIdentityRegistry();
  registry.event(delta("live", "前缀"));
  const snapshot = registry.snapshot("task", [
    turn([message("one", "前缀一"), message("two", "前缀二")]),
  ]);
  expect(snapshot[0]?.items.map((item) => item.id)).toEqual(["one", "two"]);
});

test("isolates tasks and releases aliases with task lifecycle", () => {
  const registry = new MessageIdentityRegistry();
  registry.event(complete("live", "正文"));
  expect(registry.snapshot("other", [turn([message("snapshot", "正文")])])[0]?.items[0]?.id).toBe(
    "snapshot",
  );
  registry.clearTask("task");
  expect(registry.snapshot("task", [turn([message("snapshot", "正文")])])[0]?.items[0]?.id).toBe(
    "snapshot",
  );
});

test("does not greedily merge ambiguous messages in a terminal batch", () => {
  const registry = new MessageIdentityRegistry();
  registry.snapshot("task", [turn([message("snapshot", "前缀")])]);
  const result = registry.event({
    type: "turn.completed",
    taskId: "task",
    turnId: "turn",
    payload: {
      turn: { ...turn([message("one", "前缀一"), message("two", "前缀二")]), status: "completed" },
    },
  });
  expect(result).toMatchObject({ payload: { turn: { items: [{ id: "one" }, { id: "two" }] } } });
});

test("matches image-only messages without using storage IDs or names", () => {
  const registry = new MessageIdentityRegistry();
  const user = {
    id: "live-user",
    role: "user" as const,
    type: "message" as const,
    text: "",
    attachments: [
      {
        id: "upload",
        name: "original.png",
        kind: "image" as const,
        mediaType: "image/png",
        size: 68,
      },
    ],
  };
  registry.event({ ...complete("live-user", ""), payload: { item: user } });
  const incoming = {
    ...user,
    id: "snapshot-user",
    attachments: [
      {
        id: "historical",
        name: "image-1.png",
        kind: "image" as const,
        mediaType: "image/png",
        size: 68,
      },
    ],
  };
  expect(registry.snapshot("task", [turn([incoming])])[0]?.items[0]).toMatchObject({
    id: "live-user",
    identityAliases: ["snapshot-user"],
    attachments: [{ id: "historical" }],
  });
});

test("does not equate different phases or truncated over-budget content", () => {
  const registry = new MessageIdentityRegistry();
  registry.event({
    ...complete("commentary", "相同内容"),
    payload: { item: { ...message("commentary", "相同内容"), phase: "commentary" } },
  });
  registry.event(delta("commentary", ""));
  expect(
    registry.snapshot("task", [
      turn([{ ...message("final", "相同内容"), phase: "final_answer" }]),
    ])[0]?.items[0]?.id,
  ).toBe("final");
  registry.event(complete("large", "a".repeat(20000)));
  expect(
    registry.snapshot("task", [turn([message("different", "a".repeat(19999) + "b")])])[0]?.items[0]
      ?.id,
  ).toBe("different");
});

test("retains an active turn identity while paging through completed history", () => {
  const registry = new MessageIdentityRegistry();
  registry.event(delta("live", "运行中"));
  registry.snapshot("task", [turn([message("snapshot", "运行中")])]);
  for (let index = 0; index < 150; index++) {
    registry.snapshot("task", [
      {
        ...turn([message("history", "旧消息")]),
        id: `history-${String(index)}`,
        status: "completed",
      },
    ]);
  }
  expect(registry.event(complete("snapshot", "运行中继续"))).toMatchObject({ itemId: "live" });
  registry.clear();
  expect(registry.event(delta("snapshot", "新会话"))).toMatchObject({ itemId: "snapshot" });
});
