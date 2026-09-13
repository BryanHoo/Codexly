import { deleteArchivedTasks } from "@codexly/core";
import {
  AgentMutationErrorSchema,
  DeleteArchivedTasksRequestSchema,
  DeleteArchivedTasksResponseSchema,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

export function registerArchivedTaskRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
): void {
  app.delete<{
    Params: { projectId: string };
    Headers: { "idempotency-key": string };
    Body: Record<string, never>;
  }>(
    "/v1/projects/:projectId/tasks/archived",
    {
      schema: {
        params: ProjectParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: DeleteArchivedTasksRequestSchema,
        response: {
          200: DeleteArchivedTasksResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
        },
      },
    },
    (request) =>
      context.runIdempotent(
        ["delete-archived-tasks", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const project = await context.getProjectContext(request.params.projectId);
          if (project === undefined)
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          // 部分失败也缓存为正式结果；同一请求重放不能重新选择后来归档的任务。
          return deleteArchivedTasks(project.provider, project.scope.id);
        },
      ),
  );
}
