import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpConnection, type AcpAgentLauncher } from "../src/index.js";

/** 保留会话的 SDK 对端，供应用重启测试复用；不调用真实账号或模型。 */
export function createPersistentAgentPeer() {
  const loaded: string[] = [];
  const prompts: string[] = [];
  const transcripts = new Map<string, { user: boolean; text: string }[]>();
  let native = 0;
  const options: acp.SessionConfigOption[] = [
    {
      id: "model",
      name: "模型",
      category: "model",
      type: "select",
      currentValue: "model-a",
      options: [{ value: "model-a", name: "模型 A" }],
    },
  ];
  const launch: AcpAgentLauncher = async (_engine, _scope, callbacks) => {
    const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const peer = acp
      .agent({ name: "integration" })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
      }))
      .onRequest(acp.methods.agent.session.new, () => {
        const sessionId = `native-${String(++native)}`;
        transcripts.set(sessionId, []);
        return { sessionId, configOptions: options };
      })
      .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
        loaded.push(params.sessionId);
        // 模拟持久化 agent 按 ACP 约定重放原会话，不能用空重放伪造恢复成功。
        for (const [index, entry] of (transcripts.get(params.sessionId) ?? []).entries()) {
          await client.notify(acp.methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: entry.user ? "user_message_chunk" : "agent_message_chunk",
              messageId: `${params.sessionId}-${String(index)}`,
              content: { type: "text", text: entry.text },
            },
          });
        }
        return { configOptions: options };
      })
      .onRequest(acp.methods.agent.session.close, () => ({}))
      .onRequest(acp.methods.agent.session.setConfigOption, () => ({ configOptions: options }))
      .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
        const text = params.prompt
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        prompts.push(text);
        transcripts
          .get(params.sessionId)
          ?.push({ user: true, text }, { user: false, text: `回答：${text}` });
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `回答：${text}` },
          },
        });
        return { stopReason: "end_turn" };
      })
      .connect({ readable: a.readable, writable: b.writable });
    const connection = await AcpConnection.connect(
      { readable: b.readable, writable: a.writable },
      callbacks,
    );
    return {
      connection,
      close: () => {
        connection.close();
        peer.close();
        return Promise.resolve();
      },
    };
  };
  return { launch, loaded, prompts, transcripts };
}
