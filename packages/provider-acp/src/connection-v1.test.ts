import { expect, it } from "vitest";
import * as acp from "@agentclientprotocol/sdk";
import { AcpConnection } from "./connection.js";

it("最小稳定 v1 Agent 无状态通知也能结束回合，且不接收 v2 字段", async () => {
  const outgoing = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const incoming = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const agent = acp
    .agent({ name: "stable-v1" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      expect(params.protocolVersion).toBe(1);
      return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
    })
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "v1" }))
    .onRequest(acp.methods.agent.session.prompt, ({ params }) => {
      expect(params).toEqual({ sessionId: "v1", prompt: [{ type: "text", text: "你好" }] });
      return { stopReason: "end_turn" };
    })
    .connect({ readable: outgoing.readable, writable: incoming.writable });
  let connection: AcpConnection | undefined;
  try {
    connection = await AcpConnection.connect({
      readable: incoming.readable,
      writable: outgoing.writable,
    });
    await connection.newSession({ cwd: "/tmp", mcpServers: [] });
    await expect(
      connection.prompt({ sessionId: "v1", prompt: [{ type: "text", text: "你好" }] }),
    ).resolves.toEqual({ stopReason: "end_turn" });
  } finally {
    connection?.close();
    agent.close();
  }
});

it("v1 load 响应作为历史边界，缺少可选 resume 和 close 时仍可恢复", async () => {
  const outgoing = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const incoming = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const calls: boolean[] = [];
  const agent = acp
    .agent({ name: "stable-load" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
      expect(params).toEqual({ sessionId: "saved", cwd: "/tmp", mcpServers: [] });
      await client.notify(acp.methods.client.session.update, {
        sessionId: "saved",
        update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "旧问题" } },
      });
      return {};
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId: "saved",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "回答" } },
      });
      return { stopReason: "end_turn" };
    })
    .connect({ readable: outgoing.readable, writable: incoming.writable });
  const connection = await AcpConnection.connect(
    { readable: incoming.readable, writable: outgoing.writable },
    {
      onUpdate: async (_, historical) => {
        await Promise.resolve();
        calls.push(historical);
      },
    },
  );
  try {
    await connection.resumeSession({ sessionId: "saved", cwd: "/tmp" }, true);
    expect(calls).toEqual([true]);
    await connection.prompt({ sessionId: "saved", prompt: [{ type: "text", text: "继续" }] });
    expect(calls).toEqual([true, false]);
    await connection.closeSession("saved");
    // 未声明 close 时不向 Agent 发送该方法，也不伪造原生会话已释放。
    await expect(
      connection.prompt({ sessionId: "saved", prompt: [{ type: "text", text: "再次继续" }] }),
    ).resolves.toEqual({ stopReason: "end_turn" });
  } finally {
    connection.close();
    agent.close();
  }
});
