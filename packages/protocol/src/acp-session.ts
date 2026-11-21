import { Type, type Static } from "@sinclair/typebox";
import { AcpConfigOptionSchema } from "./acp-service.js";
import { AgentEventEnvelopeProperties } from "./event-common.js";

const Text = Type.String({ maxLength: 16384 });
const Meta = Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]));

/** 命令及参数保持 ACP 原始结构，应用不能把命令名称硬编码成厂商功能。 */
export const AcpAvailableCommandSchema = Type.Object({
  name: Text,
  description: Text,
  input: Type.Optional(Type.Union([Type.Object({ hint: Text, _meta: Meta }), Type.Null()])),
  _meta: Meta,
});
export const AcpBackgroundTargetSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("terminal"), Type.Literal("tool_call")]),
    id: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);
export type AcpBackgroundTarget = Static<typeof AcpBackgroundTargetSchema>;

const AcpBackgroundWorkSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("terminal"),
    Type.Literal("tool_call"),
    Type.Literal("subagent"),
    Type.Literal("unknown"),
  ]),
  id: Type.String({ minLength: 1, maxLength: 1024 }),
  label: Type.Optional(Text),
  cancellable: Type.Boolean(),
  paused: Type.Optional(Type.Boolean()),
});

export const AcpSessionStateSchema = Type.Object(
  {
    configOptions: Type.Array(AcpConfigOptionSchema),
    availableCommands: Type.Array(AcpAvailableCommandSchema),
    foreground: Type.Optional(
      Type.Union([
        Type.Literal("running"),
        Type.Literal("requires_action"),
        Type.Literal("idle"),
        Type.Literal("unknown"),
      ]),
    ),
    background: Type.Optional(Type.Array(AcpBackgroundWorkSchema, { maxItems: 128 })),
    canSteer: Type.Optional(Type.Boolean()),
    promptReceipt: Type.Optional(Type.Object({ turnId: Text, messageId: Text })),
  },
  { additionalProperties: false },
);
export type AcpAvailableCommand = Static<typeof AcpAvailableCommandSchema>;
export type AcpSessionState = Static<typeof AcpSessionStateSchema>;

// 配置与命令走同一有序事件通道；完整状态可直接替换，不能与旧选项做字段猜测合并。
export const AcpSessionUpdatedEventSchema = Type.Object(
  {
    ...AgentEventEnvelopeProperties,
    type: Type.Literal("acp.session.updated"),
    payload: Type.Object({ state: AcpSessionStateSchema }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);
