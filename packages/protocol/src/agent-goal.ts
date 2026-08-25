import { Type, type Static } from "@sinclair/typebox";

import { DateTimeSchema } from "./project-files.js";

export const AgentGoalStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("paused"),
  Type.Literal("blocked"),
  Type.Literal("usage_limited"),
  Type.Literal("budget_limited"),
  Type.Literal("complete"),
]);

export const AgentGoalSchema = Type.Object(
  {
    createdAt: DateTimeSchema,
    objective: Type.String({ maxLength: 4_000, minLength: 1 }),
    status: AgentGoalStatusSchema,
    timeUsedSeconds: Type.Integer({ minimum: 0 }),
    tokenBudget: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    tokensUsed: Type.Integer({ minimum: 0 }),
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);

export const UpdateAgentGoalRequestSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("active"), Type.Literal("paused")]),
  },
  { additionalProperties: false },
);

export const UpdateAgentGoalResponseSchema = Type.Object(
  { goal: AgentGoalSchema },
  { additionalProperties: false },
);

export const ClearAgentGoalResponseSchema = Type.Object(
  { cleared: Type.Boolean() },
  { additionalProperties: false },
);

export type AgentGoal = Readonly<Static<typeof AgentGoalSchema>>;
export type AgentGoalStatus = Readonly<Static<typeof AgentGoalStatusSchema>>;
export type UpdateAgentGoalRequest = Readonly<Static<typeof UpdateAgentGoalRequestSchema>>;
export type UpdateAgentGoalResponse = Readonly<Static<typeof UpdateAgentGoalResponseSchema>>;
export type ClearAgentGoalResponse = Readonly<Static<typeof ClearAgentGoalResponseSchema>>;
