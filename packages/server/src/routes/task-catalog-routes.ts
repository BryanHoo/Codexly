import { listTaskCatalog } from "@codexly/core";
import { AgentTaskCatalogSchema, TaskCatalogQuerySchema } from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import type { ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, ProjectParamsSchema } from "./schemas.js";

export function registerTaskCatalogRoutes(app: FastifyInstance, context: ServerRouteContext) {
  app.get<{ Params: { projectId: string }; Querystring: { pinned?: true } }>(
    "/v1/projects/:projectId/tasks/catalog",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: TaskCatalogQuerySchema,
        response: { 200: AgentTaskCatalogSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const project = await context.getProjectContext(request.params.projectId);
      if (project === undefined)
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      return listTaskCatalog(project.provider, project.scope.id, request.query);
    },
  );
}
