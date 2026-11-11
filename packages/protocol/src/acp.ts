import { Type, type Static } from "@sinclair/typebox";
import { AgentEngineSchema } from "./agent-engine.js";
export * from "./acp-service.js";
export * from "./acp-session.js";
export { isAcpConfigOption } from "./acp-config-validation.js";

/** ACP 绑定沿用应用任务身份；sessionId 是 agent 管理的不透明标识，不能替代 taskId。 */
export const AcpTaskBindingSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1 }),
    engine: AgentEngineSchema,
    sessionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    cwd: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type AcpTaskBinding = Static<typeof AcpTaskBindingSchema>;

/** 原始配置只保留在本地迁移记录中，不得进入日志或模型上下文。 */
export const AcpSettingsMigrationSchema = Type.Object(
  {
    format: Type.Literal("acp-settings-migration"),
    version: Type.Literal(1),
    legacy: Type.Record(Type.String(), Type.Unknown()),
    values: Type.Record(Type.String(), Type.Union([Type.String(), Type.Boolean()])),
    unmapped: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type AcpSettingsMigration = Static<typeof AcpSettingsMigrationSchema>;
