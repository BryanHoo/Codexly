import {
  SearchOccurrencesPageSchema,
  SearchOccurrencesQuerySchema,
  TaskSearchPageSchema,
  TaskSearchQuerySchema,
  TEMPORARY_TASK_SCOPE_ID,
  type SearchOccurrencesQuery,
  type TaskSearchQuery,
} from "@codexly/protocol";
import type { AgentSearchScope } from "@codexly/core";
import type { FastifyPluginCallback } from "fastify";

import type { ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, ProjectTaskParamsSchema } from "./schemas.js";

export const registerSearchRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { getProjectContext, projectRepository, provider } = context;

  app.get<{ Querystring: TaskSearchQuery }>(
    "/v1/search/tasks",
    {
      schema: {
        querystring: TaskSearchQuerySchema,
        response: {
          200: TaskSearchPageSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (provider.search === undefined) {
        return reply.code(503).send({
          code: "GLOBAL_SEARCH_UNAVAILABLE",
          message: "Global search is unavailable",
        });
      }
      const projects = await projectRepository.list();
      const scopes: AgentSearchScope[] = [
        { id: TEMPORARY_TASK_SCOPE_ID, kind: "temporary" },
        ...projects.map((project) => ({ id: project.id, kind: "project" as const })),
      ];
      return provider.search.searchTasks(request.query, scopes);
    },
  );

  app.get<{
    Params: { projectId: string; taskId: string };
    Querystring: SearchOccurrencesQuery;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/search-occurrences",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        querystring: SearchOccurrencesQuerySchema,
        response: {
          200: SearchOccurrencesPageSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const project = await getProjectContext(request.params.projectId);
      if (project === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      if (provider.search === undefined) {
        return reply.code(503).send({
          code: "GLOBAL_SEARCH_UNAVAILABLE",
          message: "Global search is unavailable",
        });
      }
      return provider.search.searchTaskOccurrences(
        request.params.taskId,
        request.query,
        project.scope,
      );
    },
  );

  done();
};
