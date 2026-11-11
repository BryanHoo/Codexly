import { Type, type Static } from "@sinclair/typebox";
import { AgentPromptInputSchema } from "./agent-task.js";
import { AgentEngineSchema } from "./agent-engine.js";

const Time = Type.Integer({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
/** 新定义完全独立于旧 turnOptions；目录与项目名称由授权项目解析，不接受持久化覆盖。 */
export const AcpScheduledPlanDefinitionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    projectId: Type.String({ minLength: 1, maxLength: 128 }),
    engine: AgentEngineSchema,
    values: Type.Record(
      Type.String({ pattern: "^[\\s\\S]{1,256}$" }),
      Type.Union([Type.String({ maxLength: 16384 }), Type.Boolean()]),
      { additionalProperties: false },
    ),
    enabled: Type.Boolean(),
    prompt: AgentPromptInputSchema,
    schedule: Type.Union([
      Type.Object({ type: Type.Literal("once"), atUnixMs: Time }, { additionalProperties: false }),
      Type.Object(
        {
          type: Type.Literal("rrule"),
          startAtUnixMs: Time,
          rrule: Type.String({ minLength: 1, maxLength: 2048 }),
          timezone: Type.String({ minLength: 1, maxLength: 128 }),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
export type AcpScheduledPlanDefinition = Static<typeof AcpScheduledPlanDefinitionSchema>;
