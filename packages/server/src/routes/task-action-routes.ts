import {
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  AgentMutationErrorSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  ReloadAgentMcpServersRequestSchema,
  ReloadAgentMcpServersResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  type AgentTaskSettings,
  type CompactAgentTaskRequest,
  type ForkAgentTaskRequest,
  type ReviewAgentTaskRequest,
  type ReloadAgentMcpServersRequest,
  type UploadAgentFeedbackRequest,
} from "@codexly/protocol";
import { MutationHttpError, toMcpProviderHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectTaskParamsSchema,
} from "./schemas.js";

import type { FastifyInstance } from "fastify";

export function registerTaskActionRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const {
    assertValidProjectDefaults,
    getProjectContext,
    listModels,
    readEffectiveTaskSettings,
    runIdempotent,
    settingsRepository,
  } = context;

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/settings",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentTaskSettingsResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const task = await context.provider.readTask(request.params.taskId);
      if (task?.projectId !== context.scope.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      return {
        settings: await readEffectiveTaskSettings(request.params.projectId, request.params.taskId),
      };
    },
  );

  app.put<{
    Body: AgentTaskSettings;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/settings",
    {
      schema: {
        body: AgentTaskSettingsSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: AgentTaskSettingsResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-task-settings", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const settings = request.body;
          assertValidProjectDefaults(await listModels(), settings);
          return {
            settings: await settingsRepository.writeTaskSettings(
              request.params.projectId,
              request.params.taskId,
              settings,
            ),
          };
        },
      ),
  );

  app.post<{
    Body: ReloadAgentMcpServersRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/mcp-servers/retry",
    {
      schema: {
        body: ReloadAgentMcpServersRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: ReloadAgentMcpServersResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["reload-task-mcp-servers", request.params.projectId, request.params.taskId],
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
          try {
            return await projectContext.provider.reloadMcpServers(request.params.taskId);
          } catch (error) {
            throw toMcpProviderHttpError(error);
          }
        },
      ),
  );

  app.post<{
    Body: ReviewAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/review",
    {
      schema: {
        body: ReviewAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          201: ReviewAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const turn = await runIdempotent(
        ["review-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          return context.provider.startReview(request.params.taskId, request.body.target);
        },
      );
      return reply.code(201).send({ taskId: request.params.taskId, turn });
    },
  );

  app.post<{
    Body: CompactAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/compact",
    {
      schema: {
        body: CompactAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          202: CompactAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const response = await runIdempotent(
        ["compact-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          await context.provider.compactTask(request.params.taskId);
          return { status: "compacting" as const, taskId: request.params.taskId };
        },
      );
      return reply.code(202).send(response);
    },
  );

  app.post<{
    Body: ForkAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/fork",
    {
      schema: {
        body: ForkAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          201: ForkAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const forkedTask = await runIdempotent(
        ["fork-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          return context.provider.forkTask(request.params.taskId, request.body.lastTurnId);
        },
      );
      return reply.code(201).send({ task: forkedTask });
    },
  );

  app.post<{
    Body: UploadAgentFeedbackRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/feedback",
    {
      schema: {
        body: UploadAgentFeedbackRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: UploadAgentFeedbackResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["feedback-task", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          await context.provider.uploadFeedback(request.params.taskId, request.body);
          return { status: "sent" as const, taskId: request.params.taskId };
        },
      ),
  );
}
