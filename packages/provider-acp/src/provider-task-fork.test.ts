import * as acp from "@agentclientprotocol/sdk/unstable";
import type { AgentTurnOptions } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { fixture, input } from "./provider.test-support.js";

it("拒绝从用户消息分支，已完成回复可复制并保留首轮上下文", async () => {
  const prompts: acp.PromptRequest[] = [];
  const f = await fixture("claude", async ({ params, client }) => {
    prompts.push(params);
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "来源回答" } },
    });
    return { stopReason: "end_turn" };
  });
  f.created
    .mockReturnValueOnce({ sessionId: "source" })
    .mockReturnValueOnce({ sessionId: "branch" });
  const source = await f.provider.startTask();
  await f.provider.renameTask(source.id, "来源");
  const turn = await f.provider.startTurn(
    source.id,
    { ...input, text: "来源问题" },
    {} as AgentTurnOptions,
  );
  const settled = await vi.waitFor(async () => {
    const snapshot = await f.provider.readTask(source.id);
    expect(snapshot.status).toBe("idle");
    return snapshot.turns[0];
  });
  const user = turn.items[0];
  const reply = settled?.items.find((item) => item.type === "message" && item.role === "assistant");
  if (!user || !reply) throw new Error("缺少聊天消息");
  await expect(f.provider.forkTask(source.id, turn.id, user.id)).rejects.toThrow(
    "仅可从已完成的 Agent 回复创建任务分支",
  );
  const fork = await f.provider.forkTask(source.id, turn.id, reply.id, "retry-key");
  expect(fork).toMatchObject({ title: "来源 的复制", engine: "claude" });
  expect(fork.id).not.toBe(source.id);
  expect(await f.provider.forkTask(source.id, turn.id, reply.id, "retry-key")).toEqual(fork);
  const snapshot = await f.provider.readTask(fork.id);
  expect(snapshot.turns[0]?.items.map(({ id }) => id)).toEqual([user.id, reply.id]);
  await f.provider.startTurn(fork.id, { ...input, text: "继续" }, {} as AgentTurnOptions);
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(2);
  });
  expect(prompts[1]?.sessionId).toBe("branch");
  expect(JSON.stringify(prompts[1]?.prompt)).toContain("来源问题");
  expect(JSON.stringify(prompts[1]?.prompt)).toContain("来源回答");
});

it("原生游标从历史回复分支，下一轮直接发送到新会话", async () => {
  const sessions: string[] = [];
  const f = await fixture(
    "claude",
    async ({ params, client }) => {
      sessions.push(params.sessionId);
      const seq = String(sessions.length);
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: `reply-${seq}`,
          content: { type: "text", text: `回答 ${seq}` },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "cursor_update",
          cursorId: `after-${seq}`,
          anchor: { type: "agent_message", messageId: `reply-${seq}`, position: "after" },
          capabilities: { fork: {} },
        },
      });
      return { stopReason: "end_turn" };
    },
    undefined,
    {
      capabilities: { loadSession: true, sessionCapabilities: { fork: {}, resume: {}, close: {} } },
    },
  );
  const nativeFork = vi.fn((_context: acp.AgentRequestContext<acp.ForkSessionRequest>) => ({
    sessionId: "native-fork",
  }));
  f.app.onRequest(acp.methods.agent.session.fork, nativeFork);
  const source = await f.provider.startTask();
  const first = await f.provider.startTurn(source.id, input, {} as AgentTurnOptions);
  await vi.waitFor(async () => {
    expect((await f.provider.readTask(source.id)).status).toBe("idle");
  });
  await f.provider.startTurn(source.id, input, {} as AgentTurnOptions);
  const fork = await vi.waitFor(async () => {
    expect((await f.provider.readTask(source.id)).status).toBe("idle");
    return f.provider.forkTask(source.id, first.id, "acp:message:assistant:reply-1");
  });
  expect(nativeFork.mock.calls[0]?.[0].params).toMatchObject({
    sessionId: "native",
    cursorId: "after-1",
  });
  expect((await f.provider.readTask(fork.id)).turns).toHaveLength(1);
  await f.provider.startTurn(fork.id, input, {} as AgentTurnOptions);
  await vi.waitFor(() => {
    expect(sessions).toEqual(["native", "native", "native-fork"]);
  });
  expect(f.created).toHaveBeenCalledTimes(1);
  expect(f.loaded).not.toHaveBeenCalled();
});

it("拒绝从中断的 Agent 回复创建任务分支", async () => {
  const f = await fixture("claude", async ({ params, client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "partial",
        content: { type: "text", text: "部分回答" },
      },
    });
    return { stopReason: "cancelled" };
  });
  const source = await f.provider.startTask();
  const turn = await f.provider.startTurn(source.id, input, {} as AgentTurnOptions);
  await vi.waitFor(async () => {
    expect((await f.provider.readTask(source.id)).turns[0]?.status).toBe("interrupted");
  });
  await expect(
    f.provider.forkTask(source.id, turn.id, "acp:message:assistant:partial"),
  ).rejects.toThrow("仅可从已完成的 Agent 回复创建任务分支");
  await expect(f.provider.forkTask(source.id)).rejects.toThrow(
    "仅可从已完成的 Agent 回复创建任务分支",
  );
});
