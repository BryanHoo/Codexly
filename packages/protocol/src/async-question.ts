import { Type, type Static } from "@sinclair/typebox";
import { AgentPromptInputSchema, AgentTurnSchema } from "./agent-task.js";
import { EventCheckpointSchema } from "./event-checkpoint.js";

export const AsyncQuestionSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 100000 }),
    options: Type.Union([
      Type.Array(Type.String({ maxLength: 100000 }), { maxItems: 100 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const AsyncQuestionGroupSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    turnId: Type.String({ minLength: 1 }),
    questions: Type.Array(AsyncQuestionSchema, { minItems: 1, maxItems: 100 }),
    createdAt: Type.String(),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("answering"),
      Type.Literal("answered"),
      Type.Literal("dismissed"),
    ]),
  },
  { additionalProperties: false },
);
export type AsyncQuestionGroup = Readonly<Static<typeof AsyncQuestionGroupSchema>>;
export const AsyncQuestionPageSchema = Type.Object(
  { data: Type.Array(AsyncQuestionGroupSchema) },
  { additionalProperties: false },
);
export const AnswerAsyncQuestionRequestSchema = Type.Object(
  {
    answers: Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), {
      minItems: 1,
      maxItems: 100,
    }),
  },
  { additionalProperties: false },
);
export type AnswerAsyncQuestionRequest = Readonly<Static<typeof AnswerAsyncQuestionRequestSchema>>;
const AnswerAsyncQuestionResultProperties = {
  checkpoint: EventCheckpointSchema,
  input: AgentPromptInputSchema,
  messageId: Type.String({ minLength: 1 }),
  question: AsyncQuestionGroupSchema,
  turn: Type.Union([AgentTurnSchema, Type.Null()]),
  turnId: Type.String({ minLength: 1 }),
};
export const AnswerAsyncQuestionResultSchema = Type.Object(AnswerAsyncQuestionResultProperties, {
  additionalProperties: false,
});
export type AnswerAsyncQuestionResult = Readonly<Static<typeof AnswerAsyncQuestionResultSchema>>;
export const AnswerAsyncQuestionResponseSchema = Type.Object(
  { ...AnswerAsyncQuestionResultProperties, questions: AsyncQuestionPageSchema },
  { additionalProperties: false },
);
export type AnswerAsyncQuestionResponse = Readonly<
  Static<typeof AnswerAsyncQuestionResponseSchema>
>;
export const DismissAsyncQuestionsRequestSchema = Type.Object(
  {
    ids: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      minItems: 1,
      maxItems: 10000,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
