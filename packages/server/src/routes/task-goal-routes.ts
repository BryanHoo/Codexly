import {
  AgentMutationErrorSchema,
  ClearAgentGoalResponseSchema,
  UpdateAgentGoalRequestSchema,
  UpdateAgentGoalResponseSchema,
  type UpdateAgentGoalRequest,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";

import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectTaskParamsSchema } from "./schemas.js";

export function registerTaskGoalRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const { getProjectContext, runIdempotent } = context;

  app.put<{
    Body: UpdateAgentGoalRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/goal",
    {
      schema: {
        body: UpdateAgentGoalRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: UpdateAgentGoalResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-goal", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const projectContext = await getProjectContext(request.params.projectId);
          if (projectContext === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await projectContext.provider.readTask(request.params.taskId);
          if (task?.projectId !== projectContext.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          return {
            goal: await projectContext.provider.updateGoal(request.params.taskId, request.body),
          };
        },
      ),
  );

  app.delete<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/goal",
    {
      schema: {
        body: { additionalProperties: false, properties: {}, type: "object" },
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: ClearAgentGoalResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["clear-goal", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const projectContext = await getProjectContext(request.params.projectId);
          if (projectContext === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await projectContext.provider.readTask(request.params.taskId);
          if (task?.projectId !== projectContext.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          await projectContext.provider.clearGoal(request.params.taskId);
          return { cleared: true as const };
        },
      ),
  );
}
