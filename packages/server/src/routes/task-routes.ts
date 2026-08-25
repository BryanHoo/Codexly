import {
  AgentBackgroundTerminalPageSchema,
  AgentMcpServerPageSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  DeleteAgentTaskRequestSchema,
  DeleteAgentTaskResponseSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSnapshotResponseSchema,
  PinAgentTaskRequestSchema,
  PinAgentTaskResponseSchema,
  RenameAgentTaskRequestSchema,
  RenameAgentTaskResponseSchema,
  TerminateAgentBackgroundTerminalResponseSchema,
  UnsubscribeAgentTaskResponseSchema,
  UnarchiveAgentTaskRequestSchema,
  UnarchiveAgentTaskResponseSchema,
  type ArchiveAgentTaskRequest,
  type DeleteAgentTaskRequest,
  type PinAgentTaskRequest,
  type RenameAgentTaskRequest,
  type UnarchiveAgentTaskRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, toMcpProviderHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectParamsSchema,
  ProjectTaskParamsSchema,
  ProjectTaskTerminalParamsSchema,
  TaskPageQuerySchema,
  TaskSnapshotQuerySchema,
} from "./schemas.js";

import { registerTaskActionRoutes } from "./task-action-routes.js";
import { registerTaskAttachmentRoutes } from "./task-attachment-routes.js";
import { registerTaskGoalRoutes } from "./task-goal-routes.js";

export const registerTaskRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { getProjectContext, readEffectiveTaskSettings, runIdempotent, taskFromSnapshot } = context;

  app.get<{
    Params: { projectId: string };
    Querystring: {
      archived?: true;
      cursor?: string;
      limit?: number;
      pinned?: true;
      searchTerm?: string;
    };
  }>(
    "/v1/projects/:projectId/tasks",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: TaskPageQuerySchema,
        response: { 200: AgentTaskPageSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const input = {
        ...(request.query.archived === true ? { archived: true as const } : {}),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
        ...(request.query.pinned === true ? { pinnedOnly: true as const } : {}),
        ...(request.query.searchTerm === undefined ? {} : { searchTerm: request.query.searchTerm }),
      };
      return context.provider.listTasks(input);
    },
  );

  app.post<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/unsubscribe",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: UnsubscribeAgentTaskResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      // Provider 内部再次确认运行 Turn、Pending Request、后台终端和恢复 Promise。
      const status = await context.provider.unsubscribeTask(request.params.taskId);
      return { status, taskId: request.params.taskId };
    },
  );

  app.get<{
    Params: { projectId: string; taskId: string };
    Querystring: { cursor?: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        querystring: TaskSnapshotQuerySchema,
        response: { 200: AgentTaskSnapshotResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const task = await context.provider.readTask(request.params.taskId, {
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
      });
      if (task?.projectId !== context.scope.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      // Provider Promise 完成时已交付此前通知，此处 checkpoint 与返回 Snapshot 对齐。
      const checkpoint = context.eventStream.checkpoint;
      const settings = await readEffectiveTaskSettings(
        request.params.projectId,
        request.params.taskId,
      );
      return { checkpoint, snapshot: { ...task, settings } };
    },
  );

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/mcp-servers",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: {
          200: AgentMcpServerPageSchema,
          404: ErrorResponseSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const projectContext = await getProjectContext(request.params.projectId);
      if (projectContext === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await projectContext.provider.listMcpServers(request.params.taskId);
      } catch (error) {
        throw toMcpProviderHttpError(error);
      }
    },
  );

  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/background-terminals",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentBackgroundTerminalPageSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      // Project Provider 在 Owner 缓存缺失时才读取一次 Task，轮询不重复映射完整历史。
      return context.provider.listBackgroundTerminals(request.params.taskId);
    },
  );

  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; terminalId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/background-terminals/:terminalId/terminate",
    {
      schema: {
        body: { additionalProperties: false, properties: {}, type: "object" },
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTerminalParamsSchema,
        response: {
          200: TerminateAgentBackgroundTerminalResponseSchema,
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
        [
          "terminate-background-terminal",
          request.params.projectId,
          request.params.taskId,
          request.params.terminalId,
        ],
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
          // 终端可能在请求到达前自然退出；终止操作保持幂等成功语义。
          await context.provider.terminateBackgroundTerminal(
            request.params.taskId,
            request.params.terminalId,
          );
          return { status: "terminated" as const, terminalId: request.params.terminalId };
        },
      ),
  );

  app.put<{
    Body: PinAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/pin",
    {
      schema: {
        body: PinAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: PinAgentTaskResponseSchema,
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
        ["pin-task", request.params.projectId, request.params.taskId],
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
          return {
            task: await context.provider.pinTask(request.params.taskId, request.body.pinned),
          };
        },
      ),
  );

  app.post<{
    Body: RenameAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/rename",
    {
      schema: {
        body: RenameAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: RenameAgentTaskResponseSchema,
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
        ["rename-task", request.params.projectId, request.params.taskId],
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
          const title = request.body.title.trim();
          // Web 只提交统一标题，Codex 原生命名字段由 Provider 边界负责映射。
          await context.provider.renameTask(request.params.taskId, title);
          return { task: taskFromSnapshot(task, { title }) };
        },
      ),
  );

  app.post<{
    Body: ArchiveAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/archive",
    {
      schema: {
        body: ArchiveAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: ArchiveAgentTaskResponseSchema,
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
        ["archive-task", request.params.projectId, request.params.taskId],
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
          await context.provider.archiveTask(request.params.taskId);
          return { status: "archived" as const, taskId: request.params.taskId };
        },
      ),
  );

  app.post<{
    Body: UnarchiveAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/unarchive",
    {
      schema: {
        body: UnarchiveAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: UnarchiveAgentTaskResponseSchema,
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
        ["unarchive-task", request.params.projectId, request.params.taskId],
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
          return { task: await context.provider.unarchiveTask(request.params.taskId) };
        },
      ),
  );

  app.delete<{
    Body: DeleteAgentTaskRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      schema: {
        body: DeleteAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          200: DeleteAgentTaskResponseSchema,
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
        ["delete-task", request.params.projectId, request.params.taskId],
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
          await context.provider.deleteTask(request.params.taskId);
          return { status: "deleted" as const, taskId: request.params.taskId };
        },
      ),
  );

  registerTaskActionRoutes(app, context);
  registerTaskAttachmentRoutes(app, context);
  registerTaskGoalRoutes(app, context);
  done();
};
