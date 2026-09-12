import {
  AgentMutationErrorSchema,
  SubmitTaskRequestSchema,
  SubmitTaskResponseSchema,
  type SubmitTaskRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { executeTaskSubmission } from "../task-submission-service.js";
import type { ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

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
      schema: {
        body: SubmitTaskRequestSchema,
        params: ProjectParamsSchema,
        headers: IdempotencyHeadersSchema,
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
