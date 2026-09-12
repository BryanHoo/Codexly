import { Type, type Static } from "@sinclair/typebox";
import { AgentReviewTargetSchema, AgentTaskSchema } from "./agent-attachments.js";
import { AgentPromptInputSchema, AgentTurnSchema } from "./agent-task.js";
import { AgentTurnOptionsSchema } from "./project-settings.js";
import { EventCheckpointSchema } from "./event-checkpoint.js";

export const SubmitTaskRequestSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("prompt"),
      taskId: Type.Optional(Type.String({ minLength: 1 })),
      input: AgentPromptInputSchema,
      options: AgentTurnOptionsSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("review"),
      taskId: Type.Optional(Type.String({ minLength: 1 })),
      target: AgentReviewTargetSchema,
    },
    { additionalProperties: false },
  ),
]);
export type SubmitTaskRequest = Readonly<Static<typeof SubmitTaskRequestSchema>>;

export const SubmitTaskResponseSchema = Type.Object(
  {
    createdTask: Type.Optional(AgentTaskSchema),
    taskId: Type.String({ minLength: 1 }),
    turn: AgentTurnSchema,
    checkpoint: EventCheckpointSchema,
  },
  { additionalProperties: false },
);
export type SubmitTaskResponse = Readonly<Static<typeof SubmitTaskResponseSchema>>;
