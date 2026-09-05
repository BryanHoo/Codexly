import { Type, type Static } from "@sinclair/typebox";

import { AgentPromptInputSchema } from "./agent-task.js";
import { AgentMessageAttachmentSchema } from "./agent-attachments.js";
import { AgentTurnOptionsSchema } from "./project-settings.js";

export const ScheduledTaskScheduleSchema = Type.Union([
  Type.Object(
    { atUnixMs: Type.Integer(), type: Type.Literal("once") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      rrule: Type.String({ maxLength: 2_048, minLength: 1 }),
      startAtUnixMs: Type.Integer(),
      timezone: Type.String({ maxLength: 128, minLength: 1 }),
      type: Type.Literal("rrule"),
    },
    { additionalProperties: false },
  ),
]);
export type ScheduledTaskSchedule = Readonly<Static<typeof ScheduledTaskScheduleSchema>>;

export const ScheduledTaskRunStatusSchema = Type.Union([
  Type.Literal("failed"),
  Type.Literal("running"),
  Type.Literal("skipped"),
  Type.Literal("started"),
]);
export type ScheduledTaskRunStatus = Readonly<Static<typeof ScheduledTaskRunStatusSchema>>;

export const ScheduledTaskRunSchema = Type.Object(
  {
    error: Type.Union([Type.String(), Type.Null()]),
    finishedAtUnixMs: Type.Union([Type.Integer(), Type.Null()]),
    id: Type.String({ minLength: 1 }),
    startedAtUnixMs: Type.Integer(),
    status: ScheduledTaskRunStatusSchema,
    taskId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ScheduledTaskRun = Readonly<Static<typeof ScheduledTaskRunSchema>>;

const ScheduledTaskInputProperties = {
  enabled: Type.Boolean(),
  messageAttachments: Type.Array(AgentMessageAttachmentSchema),
  name: Type.String({ maxLength: 120, minLength: 1 }),
  projectId: Type.String({ maxLength: 128, minLength: 1 }),
  projectName: Type.String({ maxLength: 256, minLength: 1 }),
  prompt: AgentPromptInputSchema,
  schedule: ScheduledTaskScheduleSchema,
  turnOptions: AgentTurnOptionsSchema,
};

export const ScheduledTaskInputSchema = Type.Object(ScheduledTaskInputProperties, {
  additionalProperties: false,
});
export type ScheduledTaskInput = Readonly<Static<typeof ScheduledTaskInputSchema>>;

export const ScheduledTaskSchema = Type.Object(
  {
    ...ScheduledTaskInputProperties,
    createdAtUnixMs: Type.Integer(),
    id: Type.String({ minLength: 1 }),
    lastRunAtUnixMs: Type.Union([Type.Integer(), Type.Null()]),
    lastRunStatus: Type.Union([ScheduledTaskRunStatusSchema, Type.Null()]),
    nextRunAtUnixMs: Type.Union([Type.Integer(), Type.Null()]),
    runs: Type.Array(ScheduledTaskRunSchema, { maxItems: 20 }),
    updatedAtUnixMs: Type.Integer(),
  },
  { additionalProperties: false },
);
export type ScheduledTask = Readonly<Static<typeof ScheduledTaskSchema>>;

export const ScheduledTaskPageSchema = Type.Object(
  { data: Type.Array(ScheduledTaskSchema) },
  { additionalProperties: false },
);
export type ScheduledTaskPage = Readonly<Static<typeof ScheduledTaskPageSchema>>;

export const ScheduledTaskMutationResponseSchema = Type.Object(
  { task: ScheduledTaskSchema },
  { additionalProperties: false },
);
export type ScheduledTaskMutationResponse = Readonly<
  Static<typeof ScheduledTaskMutationResponseSchema>
>;

export const DeleteScheduledTaskResponseSchema = Type.Object(
  { status: Type.Literal("deleted"), taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type DeleteScheduledTaskResponse = Readonly<
  Static<typeof DeleteScheduledTaskResponseSchema>
>;

export const SetScheduledTaskEnabledRequestSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);
export type SetScheduledTaskEnabledRequest = Readonly<
  Static<typeof SetScheduledTaskEnabledRequestSchema>
>;
