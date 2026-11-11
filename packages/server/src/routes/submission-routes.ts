import {
  AgentMutationErrorSchema,
  SubmitTaskRequestSchema,
  SubmitTaskResponseSchema,
  type SubmitTaskRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback, FastifySchema, FastifySchemaCompiler } from "fastify";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { executeTaskSubmission } from "../task-submission-service.js";
import type { ServerRouteContext } from "./context.js";

// 联合类型不能让 AJV 在尝试其他分支时删除字段；保持原始输入再进行严格校验。
const validatorCompiler: FastifySchemaCompiler<FastifySchema> =
  ({ schema }) =>
  (value) =>
    Value.Check(schema as TSchema, value) ? { value } : { error: new Error("Invalid submission") };

export const registerSubmissionRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  app.post<{
    Body: SubmitTaskRequest;
    Params: { projectId: string };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects/:projectId/submissions",
    {
      validatorCompiler,
      schema: {
        body: SubmitTaskRequestSchema,
        params: Type.Object(
          { projectId: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
        headers: Type.Object({ "idempotency-key": Type.String({ minLength: 1 }) }),
        response: {
          201: SubmitTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await context.runIdempotent(
        ["submit-task", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        () =>
          executeTaskSubmission(
            context,
            context.submissionRepository,
            request.params.projectId,
            request.headers["idempotency-key"],
            request.body,
          ),
      );
      return reply.code(201).send(result);
    },
  );
  done();
};
