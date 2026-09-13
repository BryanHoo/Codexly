import {
  AgentMutationErrorSchema,
  UpdateTaskSettingsAndDefaultsRequestSchema,
  UpdateTaskSettingsAndDefaultsResponseSchema,
  type UpdateTaskSettingsAndDefaultsRequest,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectTaskParamsSchema } from "./schemas.js";

export function registerTaskSettingsDefaultsRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
): void {
  app.put<{
    Body: UpdateTaskSettingsAndDefaultsRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/settings-and-defaults",
    {
      schema: {
        body: UpdateTaskSettingsAndDefaultsRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: UpdateTaskSettingsAndDefaultsResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    (request) =>
      context.runIdempotent(
        ["update-task-settings-and-defaults", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const project = await context.getProjectContext(request.params.projectId);
          if (project === undefined)
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          const task = await project.provider.readTask(request.params.taskId);
          if (task?.projectId !== project.scope.id)
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);

          const { settings, fastMode } = request.body;
          const defaults = { ...settings, fastMode };
          // 在任何持久化前完成整份意图校验，避免无效默认值造成 Task 单边写入。
          context.assertValidProjectDefaults(await context.listModels(), defaults);
          const activeTurn = task.turns.findLast((turn) => turn.status === "running");
          if (activeTurn !== undefined) {
            const previous = await context.readEffectiveTaskSettings(
              request.params.projectId,
              request.params.taskId,
            );
            if (previous.approvalsReviewer !== settings.approvalsReviewer) {
              await project.provider.updateTurnApprovalsReviewer(
                request.params.taskId,
                activeTurn.id,
                settings.approvalsReviewer,
              );
            }
          }
          const savedSettings = await context.settingsRepository.writeTaskSettings(
            request.params.projectId,
            request.params.taskId,
            settings,
          );
          const savedDefaults = await context.settingsRepository.writeProjectDefaults(
            request.params.projectId,
            defaults,
          );
          return { settings: savedSettings, defaults: savedDefaults };
        },
      ),
  );
}
