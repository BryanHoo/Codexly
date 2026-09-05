import { Type, type Static, type TSchema } from "@sinclair/typebox";

import {
  AgentTaskSchema,
  AgentThreadConfigurationSchema,
  type AgentTask,
} from "./agent-attachments.js";
import { DateTimeSchema, ProjectSchema, type Project } from "./project-files.js";
import { ActivePendingRequestSchema } from "./pending-request.js";
import { AgentSkillSchema, AgentTurnSchema, type AgentSkill } from "./agent-task.js";
import { AgentGoalSchema } from "./agent-goal.js";
import {
  AgentContextUsageSchema,
  AgentModelSchema,
  AgentTaskSettingsSchema,
  type AgentModel,
} from "./project-settings.js";

export const TEMPORARY_TASK_SCOPE_ID = "temporary";
export const TEMPORARY_TASK_API_PATH = "/v1/temporary";

export * from "./pending-request.js";

export const AgentPlanStepStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
]);

export const AgentPlanStepSchema = Type.Object(
  {
    status: AgentPlanStepStatusSchema,
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AgentPlanSchema = Type.Object(
  {
    explanation: Type.Union([Type.String(), Type.Null()]),
    steps: Type.Array(AgentPlanStepSchema),
  },
  { additionalProperties: false },
);

export type AgentPlanStepStatus = Readonly<Static<typeof AgentPlanStepStatusSchema>>;
export type AgentPlanStep = Readonly<Static<typeof AgentPlanStepSchema>>;
export type AgentPlan = Readonly<Static<typeof AgentPlanSchema>>;

export const AgentTaskSnapshotSchema = Type.Object(
  {
    contextUsage: Type.Union([AgentContextUsageSchema, Type.Null()]),
    goal: Type.Union([AgentGoalSchema, Type.Null()]),
    id: Type.String({ minLength: 1 }),
    plan: Type.Union([AgentPlanSchema, Type.Null()]),
    pendingRequests: Type.Array(ActivePendingRequestSchema),
    pinned: Type.Boolean(),
    projectId: Type.String({ minLength: 1 }),
    settings: AgentTaskSettingsSchema,
    threadConfiguration: Type.Optional(AgentThreadConfigurationSchema),
    status: Type.Union([Type.Literal("idle"), Type.Literal("running"), Type.Literal("failed")]),
    title: Type.String({ minLength: 1 }),
    turns: Type.Array(AgentTurnSchema),
    turnsNextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);

export type AgentTaskSnapshot = Readonly<Static<typeof AgentTaskSnapshotSchema>>;

export type Page<T> = Readonly<{
  data: readonly T[];
  nextCursor: string | null;
}>;

function createPageSchema<T extends TSchema>(itemSchema: T) {
  return Type.Object(
    {
      data: Type.Array(itemSchema),
      nextCursor: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  );
}

export const ProjectPageSchema = createPageSchema(ProjectSchema);
export type ProjectPage = Page<Project>;

export const ReorderProjectsResponseSchema = ProjectPageSchema;
export type ReorderProjectsResponse = ProjectPage;

export const AgentTaskPageSchema = createPageSchema(AgentTaskSchema);
export type AgentTaskPage = Page<AgentTask>;

export const AgentModelPageSchema = createPageSchema(AgentModelSchema);
export type AgentModelPage = Page<AgentModel>;

export const AgentSkillPageSchema = createPageSchema(AgentSkillSchema);
export type AgentSkillPage = Page<AgentSkill>;

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type HealthResponse = Readonly<Static<typeof HealthResponseSchema>>;

export const AgentCapabilitiesSchema = Type.Object(
  {
    feedback: Type.Object({ upload: Type.Boolean() }, { additionalProperties: false }),
    goals: Type.Object(
      { clear: Type.Boolean(), read: Type.Boolean(), update: Type.Boolean() },
      { additionalProperties: false },
    ),
    provider: Type.String({ minLength: 1 }),
    skills: Type.Object(
      { list: Type.Boolean(), use: Type.Boolean() },
      { additionalProperties: false },
    ),
    tasks: Type.Object(
      {
        fork: Type.Boolean(),
        list: Type.Boolean(),
        read: Type.Boolean(),
        start: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    turns: Type.Object(
      {
        compact: Type.Boolean(),
        interrupt: Type.Boolean(),
        review: Type.Boolean(),
        start: Type.Boolean(),
        steer: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AgentCapabilities = Readonly<Static<typeof AgentCapabilitiesSchema>>;
