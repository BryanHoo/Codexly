import { Type, type Static } from "@sinclair/typebox";
import { AgentReviewTargetSchema } from "./agent-attachments.js";
import { ReviewAgentTaskResponseSchema } from "./agent-actions.js";
import { taskSubmissionResponseSchema } from "./task-submission.js";

export const SubmitReviewRequestSchema = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 1024 }),
  taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  target: AgentReviewTargetSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
}, { additionalProperties: false });
export type SubmitReviewRequest = Readonly<Static<typeof SubmitReviewRequestSchema>>;
export const SubmitReviewResponseSchema = taskSubmissionResponseSchema(ReviewAgentTaskResponseSchema);
