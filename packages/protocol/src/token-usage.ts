import { Type, type Static } from "@sinclair/typebox";
const Counter = Type.Union([
  Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  Type.Null(),
]);
export const TokenUsageCountersSchema = Type.Object({
  totalTokens: Counter,
  inputTokens: Counter,
  outputTokens: Counter,
  cacheReadTokens: Counter,
  cacheWriteTokens: Counter,
});
export type TokenUsageCounters = Readonly<Static<typeof TokenUsageCountersSchema>>;
export const TokenUsageQuerySchema = Type.Object(
  {
    year: Type.Integer({ minimum: 2000, maximum: 9999 }),
    engine: Type.Optional(Type.Union([Type.Literal("codex"), Type.Literal("claude")])),
    day: Type.Optional(Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" })),
  },
  { additionalProperties: false },
);
export type TokenUsageQuery = Readonly<Static<typeof TokenUsageQuerySchema>>;
export const TokenUsageResponseSchema = Type.Object({
  days: Type.Array(
    Type.Intersect([
      TokenUsageCountersSchema,
      Type.Object({
        day: Type.String(),
        engine: Type.Union([Type.Literal("codex"), Type.Literal("claude")]),
        taskCount: Type.Integer({ minimum: 0 }),
      }),
    ]),
  ),
  tasks: Type.Array(
    Type.Intersect([
      TokenUsageCountersSchema,
      Type.Object({
        taskId: Type.String(),
        title: Type.String(),
        engine: Type.Union([Type.Literal("codex"), Type.Literal("claude")]),
      }),
    ]),
  ),
});
export type TokenUsageResponse = Readonly<Static<typeof TokenUsageResponseSchema>>;
/** 快照按 source 单调累加；baseline 只在首次采集时排除旧会话历史。 */
export type TokenUsageSample = TokenUsageCounters &
  Readonly<{
    engine: "codex" | "claude";
    source: string;
    taskId: string;
    timestamp: string;
    baseline?: TokenUsageCounters;
  }>;
export type CodexTokenUsageSample = Readonly<{
  source: string;
  taskId: string;
  timestamp: string;
  tokenUsage: unknown;
}>;
