import { AgentThreadMemorySchema } from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ProjectTaskParamsSchema } from "./schemas.js";

export function registerTaskMemoryRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/memory",
    {
      schema: { params: ProjectTaskParamsSchema, response: { 200: AgentThreadMemorySchema } },
    },
    async (request, reply) => {
      // 摘要可能包含项目私密信息，不允许 HTTP 缓存，沿用全局认证及任务归属校验。
      reply.header("Cache-Control", "no-store");
      const project = await context.getProjectContext(request.params.projectId);
      if (!project) throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      const task = await (project.provider.readTaskMetadata?.(request.params.taskId) ??
        project.provider.readTask(request.params.taskId));
      if (task?.projectId !== project.scope.id)
        throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
      return (
        project.provider.readThreadMemory?.(request.params.taskId) ?? {
          status: "unsupported",
          summary: null,
        }
      );
    },
  );
}
