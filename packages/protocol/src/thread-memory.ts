import { Type, type Static } from "@sinclair/typebox";

// null 是已加载会话的正常空摘要；不能与会话未加载或接口不可用混为一谈。
export const AgentThreadMemorySchema = Type.Union([
  Type.Object(
    { status: Type.Literal("ready"), summary: Type.Union([Type.String(), Type.Null()]) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Union([Type.Literal("not_loaded"), Type.Literal("unsupported")]),
      summary: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);
export type AgentThreadMemory = Readonly<Static<typeof AgentThreadMemorySchema>>;
