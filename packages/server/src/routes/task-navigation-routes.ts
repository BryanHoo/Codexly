import { NavigableAgentTaskResponseSchema } from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { readNavigableProviderTask } from "../task-navigation.js";
import type { ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, ProjectTaskParamsSchema } from "./schemas.js";

export function registerTaskNavigationRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
): void {
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/navigation",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: NavigableAgentTaskResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const project = await context.getProjectContext(request.params.projectId);
      if (project === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const task = await readNavigableProviderTask(
        project.provider,
        project.scope.id,
        request.params.taskId,
      );
      if (task === null) return { task: null };
      const settings = await context.readEffectiveTaskSettings(
        request.params.projectId,
        request.params.taskId,
      );
      return {
        task: {
          checkpoint: project.eventStream.checkpoint,
          snapshot: { ...task, settings },
        },
      };
    },
  );
}
