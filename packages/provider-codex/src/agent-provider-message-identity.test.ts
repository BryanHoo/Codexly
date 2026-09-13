import { expect, test } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

test("shares normalized IDs between provider snapshots and every realtime subscriber", async () => {
  const nativeItem = {
    id: "snapshot-id",
    type: "agentMessage",
    delivery: null,
    questions: null,
    text: "正在处理",
    phase: "commentary",
  };
  const nativeTurn = {
    id: "turn-1",
    items: [nativeItem],
    itemsView: "full",
    status: "inProgress",
    startedAt: 1753228800,
    completedAt: null,
    error: null,
  };
  const rpc = new FakeRpcClient([
    { data: [nativeThread()], nextCursor: null },
    { thread: nativeThread({ turns: [nativeTurn] }) },
  ]);
  const provider = createCodexAgentProvider({ client: rpc, project });
  const first: AgentProviderEvent[] = [];
  const second: AgentProviderEvent[] = [];
  provider.subscribeEvents((event) => first.push(event));
  provider.subscribeEvents((event) => second.push(event));
  await provider.listTasks();
  rpc.emitNotification("item/agentMessage/delta", {
    threadId: "task-1",
    turnId: "turn-1",
    itemId: "live-id",
    delta: "正在",
  });
  const snapshot = await provider.readTask("task-1");
  expect(snapshot?.turns[0]?.items[0]).toMatchObject({
    id: "live-id",
    identityAliases: ["snapshot-id"],
  });
  rpc.emitNotification("item/completed", {
    threadId: "task-1",
    turnId: "turn-1",
    item: { ...nativeItem, id: "live-id", text: "正在处理完成" },
  });
  expect(first.at(-1)).toMatchObject({
    itemId: "live-id",
    payload: { item: { id: "live-id", identityAliases: ["snapshot-id"] } },
  });
  expect(second).toEqual(first);
});
