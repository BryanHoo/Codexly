import { CompletedTasksQueryError, queryCompletedTasks } from "@codexly/core";
import {
  CompletedTasksPageSchema,
  CompletedTasksQuerySchema,
  type CompletedTasksQuery,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema } from "./schemas.js";

export function registerCompletedTaskQueryRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
) {
  // POST 仅承载结构化查询，不执行写操作，也不建立幂等写缓存。
  app.post<{ Body: CompletedTasksQuery }>(
    "/v1/tasks/completed/query",
    {
      schema: {
        body: CompletedTasksQuerySchema,
        response: {
          200: CompletedTasksPageSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await queryCompletedTasks(async (id) => {
          const project = await context.getProjectContext(id);
          if (project === undefined)
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          return project.provider;
        }, request.body);
      } catch (error) {
        if (error instanceof CompletedTasksQueryError)
          return reply.code(400).send({ code: "INVALID_QUERY", message: error.message });
        throw error;
      }
    },
  );
}
