import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const prompts = new Map();
const configOptions = [
  {
    id: "model",
    name: "模型",
    category: "model",
    type: "select",
    currentValue: "gpt-5.6-sol",
    options: [{ value: "gpt-5.6-sol", name: "gpt-5.6-sol" }],
  },
];
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const update = (sessionId, payload) =>
  send({
    method: "session/update",
    params: { sessionId, update: payload },
  });
const text = (sessionId, value) =>
  update(sessionId, {
    sessionUpdate: "agent_message_chunk",
    messageId: "assistant",
    content: { type: "text", text: value },
  });

// 测试 Agent 使用与生产宿主相同的 ACP v1 stdio 通道，事件由共享 Provider 投影。
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  const reply = (result) => send({ id, result });
  switch (method) {
    case "initialize":
      reply({
        protocolVersion: 1,
        agentInfo: { name: "fixture-acp", version: "1.0.0" },
        agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
        authMethods: [],
      });
      break;
    case "session/new":
      reply({ sessionId: randomUUID(), configOptions });
      break;
    case "session/load":
      if (params.sessionId === "fixture-existing") {
        update(params.sessionId, {
          sessionUpdate: "user_message_chunk",
          messageId: "seed",
          content: { type: "text", text: "ACP 历史输入" },
        });
        text(params.sessionId, "ACP 历史回复");
      }
      reply({ configOptions });
      break;
    case "session/set_config_option":
      reply({ configOptions });
      break;
    case "session/close":
      reply({});
      break;
    case "session/prompt": {
      const { sessionId, prompt } = params;
      const input = prompt
        .filter(({ type }) => type === "text")
        .map(({ text }) => text)
        .join("\n");
      if (input === "等待中断") {
        text(sessionId, "正在处理");
        prompts.set(sessionId, id);
        return;
      }
      text(sessionId, "流式");
      setTimeout(() => {
        text(sessionId, "回复完成");
        reply({ stopReason: "end_turn" });
      }, 35);
      break;
    }
    case "session/cancel": {
      const promptId = prompts.get(params.sessionId);
      if (promptId !== undefined) {
        prompts.delete(params.sessionId);
        send({ id: promptId, result: { stopReason: "cancelled" } });
      }
      break;
    }
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: "Method not found" } });
  }
});
