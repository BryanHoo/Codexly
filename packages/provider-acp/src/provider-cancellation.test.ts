import { expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { fixture, input } from "./provider.test-support.js";
import type { AcpConnection } from "./connection.js";

it("中断准确回合时取消其待审批，保留其他会话审批与两份历史", async () => {
  const responses = new Map<string, acp.RequestPermissionResponse>();
  const lateResponses = new Map<string, acp.RequestPermissionResponse>();
  const f = await fixture("codex", async ({ client, params }) => {
    const response = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: `tool-${params.sessionId}`, title: "写入" },
      options: [{ optionId: "once", kind: "allow_once", name: "允许一次" }],
    });
    responses.set(params.sessionId, response);
    if (response.outcome.outcome === "cancelled") {
      // 模拟取消已发出、对端仍在收尾时到达的新审批，不能重新阻塞或弹窗。
      const late = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: `late-${params.sessionId}`, title: "迟到写入" },
        options: [{ optionId: "once", kind: "allow_once", name: "允许一次" }],
      });
      lateResponses.set(params.sessionId, late);
    }
    return { stopReason: response.outcome.outcome === "cancelled" ? "cancelled" : "end_turn" };
  });
  f.created
    .mockReturnValueOnce({ sessionId: "native-one", configOptions: [] })
    .mockReturnValueOnce({ sessionId: "native-two", configOptions: [] });
  const first = await f.provider.startTask();
  const second = await f.provider.startTask();
  const firstTurn = await f.provider.startConfiguredTurn(first.id, input);
  await f.provider.startConfiguredTurn(second.id, input);
  await vi.waitFor(async () => {
    expect((await f.provider.readTask(first.id)).pendingRequests).toHaveLength(1);
  });
  await vi.waitFor(async () => {
    expect((await f.provider.readTask(second.id)).pendingRequests).toHaveLength(1);
  });
  await f.provider.interruptTurn(first.id, "stale-turn");
  expect((await f.provider.readTask(first.id)).pendingRequests).toHaveLength(1);
  await f.provider.interruptTurn(first.id, firstTurn.id);
  await vi.waitFor(() => {
    expect(responses.get("native-one")).toEqual({ outcome: { outcome: "cancelled" } });
  });
  expect(responses.has("native-two")).toBe(false);
  expect((await f.provider.readTask(first.id)).pendingRequests).toEqual([]);
  const pending = (await f.provider.readTask(second.id)).pendingRequests[0];
  if (!pending) throw new Error("其他会话的审批不应消失");
  await f.provider.resolvePendingRequest({
    ...pending,
    type: "tool_approval",
    resolution: { decision: "allow", optionId: "once" },
  });
  await vi.waitFor(async () => {
    expect((await f.history.read(first.id)).turns[0]?.status).toBe("interrupted");
    expect((await f.history.read(second.id)).turns[0]?.status).toBe("completed");
  });
  expect(lateResponses.get("native-one")).toEqual({ outcome: { outcome: "cancelled" } });
  expect(f.tasks.get(first.id)?.sessionId).toBe("native-one");
  expect(f.tasks.get(second.id)?.sessionId).toBe("native-two");
  expect(f.created).toHaveBeenCalledTimes(2);
});

it("旧回合结束与取消通知等待并发时，新回合等待取消写出，续聊审批仍可正常处理", async () => {
  const completed = Promise.withResolvers<acp.PromptResponse>();
  let connection: AcpConnection | undefined;
  let prompts = 0;
  const f = await fixture(
    "claude",
    async ({ client, params }) => {
      if (++prompts === 1) return completed.promise;
      await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: "next", title: "继续写入" },
        options: [{ optionId: "once", kind: "allow_once", name: "允许一次" }],
      });
      return { stopReason: "end_turn" };
    },
    (next, _id, options) => {
      connection = next;
      return Promise.resolve(options);
    },
  );
  const task = await f.provider.startTask();
  const turn = await f.provider.startConfiguredTurn(task.id, input);
  if (!connection) throw new Error("没有建立 ACP 连接");
  const entered = Promise.withResolvers<undefined>();
  const send = Promise.withResolvers<undefined>();
  const original = connection.cancel.bind(connection);
  vi.spyOn(connection, "cancel").mockImplementation(async (session) => {
    entered.resolve(undefined);
    await send.promise;
    return original(session);
  });
  const cancelling = f.provider.interruptTurn(task.id, turn.id);
  await entered.promise;
  completed.resolve({ stopReason: "end_turn" });
  await vi.waitFor(async () => {
    expect((await f.history.read(task.id)).turns).toHaveLength(1);
  });
  const submitted = vi.fn();
  const starting = f.provider.startConfiguredTurn(task.id, input).then((next) => {
    submitted();
    return next;
  });
  try {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(submitted).not.toHaveBeenCalled();
  } finally {
    send.resolve(undefined);
  }
  await cancelling;
  const next = await starting;
  const pending = await vi.waitFor(async () => {
    const request = (await f.provider.readTask(task.id)).pendingRequests[0];
    if (!request) throw new Error("等待续聊审批");
    return request;
  });
  expect(pending.turnId).toBe(next.id);
  await f.provider.resolvePendingRequest({
    ...pending,
    type: "tool_approval",
    resolution: { decision: "allow", optionId: "once" },
  });
  await vi.waitFor(async () => {
    expect((await f.history.read(task.id)).turns).toHaveLength(2);
  });
  expect(f.created).toHaveBeenCalledOnce();
});
