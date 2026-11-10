import { expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AcpSessionStateSchema } from "./acp.js";
import { AgentEventSchema } from "./agent-event.js";

it("ACP会话状态与事件保留命令参数、分组配置和扩展元数据", () => {
  const state = {
    configOptions: [
      {
        id: "model",
        name: "模型",
        type: "select",
        currentValue: "a",
        options: [{ group: "provider", name: "供应商", options: [{ value: "a", name: "A" }] }],
        _meta: { vendor: { future: true } },
      },
    ],
    availableCommands: [
      {
        name: "review",
        description: "检查",
        input: { hint: "目标", _meta: { kind: "text" } },
        _meta: { future: 1 },
      },
    ],
  };
  expect(Value.Check(AcpSessionStateSchema, state)).toBe(true);
  const event = {
    type: "acp.session.updated",
    taskId: "t",
    provider: "claude",
    version: 2,
    sequence: 1,
    sessionId: "application-events",
    timestamp: new Date().toISOString(),
    payload: { state },
  };
  expect(Value.Check(AgentEventSchema, event)).toBe(true);
  expect(
    Value.Check(AcpSessionStateSchema, {
      ...state,
      configOptions: [{ id: "toggle", name: "开关", type: "boolean", currentValue: "false" }],
    }),
  ).toBe(false);
  expect(
    Value.Check(AcpSessionStateSchema, {
      ...state,
      availableCommands: [{ name: "review", description: "检查", input: { hint: 123 } }],
    }),
  ).toBe(false);
});
