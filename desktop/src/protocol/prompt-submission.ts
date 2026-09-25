import { Type, type Static } from "@sinclair/typebox";
import { taskSubmissionResponseSchema } from "./task-submission.js";
import { AgentPromptInputSchema } from "./agent-task.js";
import { AgentTurnOptionsSchema } from "./project-settings.js";
import { StartAgentTurnResponseSchema } from "./agent-actions.js";

const KeySchema = Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" });
export const SubmitPromptRequestSchema = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 1024 }),
  taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  input: AgentPromptInputSchema,
  turnOptions: AgentTurnOptionsSchema,
  idempotencyKeys: Type.Object({ startTask: Type.Optional(KeySchema), startTurn: KeySchema }, { additionalProperties: false }),
}, { additionalProperties: false });
export type SubmitPromptRequest = Readonly<Static<typeof SubmitPromptRequestSchema>>;

export const SubmitPromptResponseSchema = taskSubmissionResponseSchema(StartAgentTurnResponseSchema);
export type SubmitPromptResponse = Readonly<Static<typeof SubmitPromptResponseSchema>>;
