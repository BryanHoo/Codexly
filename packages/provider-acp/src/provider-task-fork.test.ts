import * as acp from "@agentclientprotocol/sdk/unstable";
import type { AgentTurnOptions } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { fixture, input } from "./provider.test-support.js";

it("从历史用户消息复制任务，重试复用任务，首轮带上前文", async () => {
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
  await vi.waitFor(async () => {
    expect((await f.provider.readTask(source.id)).status).toBe("idle");
  });
  const item = turn.items[0];
  if (!item) throw new Error("缺少用户消息");
  const fork = await f.provider.forkTask(source.id, turn.id, item.id, "retry-key");
  expect(fork).toMatchObject({ title: "来源 的复制", engine: "claude" });
  expect(fork.id).not.toBe(source.id);
  expect(await f.provider.forkTask(source.id, turn.id, item.id, "retry-key")).toEqual(fork);
  const snapshot = await f.provider.readTask(fork.id);
  expect(snapshot.turns[0]?.items.map(({ id }) => id)).toEqual([item.id]);
  await f.provider.startTurn(fork.id, { ...input, text: "继续" }, {} as AgentTurnOptions);
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(2);
  });
  expect(prompts[1]?.sessionId).toBe("branch");
  expect(JSON.stringify(prompts[1]?.prompt)).toContain("来源问题");
  expect(JSON.stringify(prompts[1]?.prompt)).not.toContain("来源回答");
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
