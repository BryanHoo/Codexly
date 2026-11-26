import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AgentPromptInputSchema, AgentTurnSchema } from "./agent-task.js";

// 文件仓储和历史兼容入口共用磁盘契约，Core 不直接依赖 Schema 实现库。
const StoredTaskQueueSchema = Type.Array(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    taskId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    clientUserMessageId: Type.String({ minLength: 1 }),
    input: AgentPromptInputSchema,
    status: Type.Union([Type.Literal("queued"), Type.Literal("editing")]),
    execution: Type.Optional(
      Type.Union([
        Type.Object({ state: Type.Literal("starting") }),
        Type.Object({ state: Type.Literal("started"), turn: AgentTurnSchema }),
      ]),
    ),
  }),
  { maxItems: 128 },
);

export function isStoredTaskQueue(value: unknown) {
  return Value.Check(StoredTaskQueueSchema, value);
}
