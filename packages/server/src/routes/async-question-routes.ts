import { Type } from "@sinclair/typebox";
import {
  AgentMutationErrorSchema,
  AsyncQuestionPageSchema,
  AnswerAsyncQuestionRequestSchema,
  AnswerAsyncQuestionResponseSchema,
  DismissAsyncQuestionsRequestSchema,
  type AnswerAsyncQuestionRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { AsyncQuestionService } from "../async-question-service.js";
import type { ServerRouteContext } from "./context.js";
import { ProjectTaskParamsSchema, IdempotencyHeadersSchema } from "./schemas.js";

interface Params {
  projectId: string;
  taskId: string;
  questionId: string;
}
interface Headers {
  "idempotency-key": string;
}
const errors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
};
export const registerAsyncQuestionRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const service = new AsyncQuestionService(context);
  const path = "/v1/projects/:projectId/tasks/:taskId/async-questions";
  app.get<{ Params: Params }>(
    path,
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AsyncQuestionPageSchema, ...errors },
      },
    },
    (request) => service.list(request.params.projectId, request.params.taskId),
  );
  app.post<{ Params: Params; Body: AnswerAsyncQuestionRequest; Headers: Headers }>(
    `${path}/:questionId/answer`,
    {
      schema: {
        params: Type.Object({
          projectId: Type.String({ minLength: 1 }),
          taskId: Type.String({ minLength: 1 }),
          questionId: Type.String({ minLength: 1, maxLength: 128 }),
        }),
        headers: IdempotencyHeadersSchema,
        body: AnswerAsyncQuestionRequestSchema,
        response: { 200: AnswerAsyncQuestionResponseSchema, ...errors },
      },
    },
    (request) =>
      context.runIdempotent(
        [
          "answer-async-question",
          request.params.projectId,
          request.params.taskId,
          request.params.questionId,
        ],
        request.headers["idempotency-key"],
        request.body,
        () =>
          service.answer(
            request.params.projectId,
            request.params.taskId,
            request.params.questionId,
            request.body.answers,
          ),
      ),
  );
  app.post<{ Params: Params; Body: { ids: string[] }; Headers: Headers }>(
    `${path}/dismiss`,
    {
      schema: {
        params: ProjectTaskParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: DismissAsyncQuestionsRequestSchema,
        response: { 200: AsyncQuestionPageSchema, ...errors },
      },
    },
    (request) =>
      context.runIdempotent(
        ["dismiss-async-questions", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        () => service.dismiss(request.params.projectId, request.params.taskId, request.body.ids),
      ),
  );
  done();
};
