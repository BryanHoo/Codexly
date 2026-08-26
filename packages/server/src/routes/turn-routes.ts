import { PendingRequestResolutionError } from "@codexly/core";
import {
  AgentMutationErrorSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  SteerAgentTurnRequestSchema,
  SteerAgentTurnResponseSchema,
  type ResolvePendingRequestRequest,
  type StartAgentTurnRequest,
  type SteerAgentTurnRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  IdempotencyHeadersSchema,
  ProjectParamsSchema,
  ProjectTaskParamsSchema,
  ProjectTaskPendingRequestParamsSchema,
  ProjectTaskTurnParamsSchema,
} from "./schemas.js";

export const registerTurnRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const {
    assertValidProjectDefaults,
    attachmentStore,
    fingerprintPayload,
    getProjectContext,
    idempotencyCacheSize,
    listModels,
    readInheritedTaskSettings,
    resolveProviderTurnInput,
    runIdempotent,
    settingsRepository,
    taskStartRecoveries,
    toPendingRequestHttpError,
  } = context;

  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/tasks",
    {
      schema: {
        body: StartAgentTaskRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          201: StartAgentTaskResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const task = await runIdempotent(
        ["start-task", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const recoveryKey = JSON.stringify([
            "start-task",
            request.params.projectId,
            request.headers["idempotency-key"],
          ]);
          const fingerprint = fingerprintPayload(request.body);
          let recovery = taskStartRecoveries.get(recoveryKey);
          if (recovery !== undefined && recovery.fingerprint !== fingerprint) {
            throw new MutationHttpError(
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key was already used with another request",
              409,
            );
          }
          if (recovery === undefined) {
            if (taskStartRecoveries.size >= idempotencyCacheSize) {
              throw new Error("Task creation recovery capacity is exhausted");
            }
            const defaults = await readInheritedTaskSettings(request.params.projectId);
            const task = await context.provider.startTask();
            // Provider 已创建 Task 后立即保留恢复状态，后续落库重试不能再次创建 Task。
            recovery = {
              fingerprint,
              settings: {
                ...defaults,
              },
              task,
            };
            taskStartRecoveries.set(recoveryKey, recovery);
          }
          await settingsRepository.writeTaskSettings(
            request.params.projectId,
            recovery.task.id,
            recovery.settings,
          );
          taskStartRecoveries.delete(recoveryKey);
          return recovery.task;
        },
      );
      return reply.code(201).send({ task });
    },
  );

  app.post<{
    Body: StartAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns",
    {
      schema: {
        body: StartAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: {
          201: StartAgentTurnResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const started = await runIdempotent(
        ["start-turn", request.params.projectId, request.params.taskId],
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
          const { attachmentIds, providerInput } = await resolveProviderTurnInput(
            request.params.projectId,
            request.body.input,
            context.provider,
            request.params.taskId,
          );
          const turnOptions = request.body.options;
          assertValidProjectDefaults(await listModels(), turnOptions);
          // Turn 设置先落库，Provider 成功或进程退出后都能恢复用户最后一次完整选择。
          await settingsRepository.writeTaskSettings(
            request.params.projectId,
            request.params.taskId,
            turnOptions,
          );
          // 先固定事件起点，首轮启动期间产生的事件由前端从该位置完整回放。
          const checkpoint = context.eventStream.checkpoint;
          const turn = await context.provider.startTurn(
            request.params.taskId,
            providerInput,
            turnOptions,
          );
          // 只有 Provider 确认启动成功后才消费附件，网络失败仍允许原请求重试。
          await attachmentStore.consume(
            request.params.projectId,
            attachmentIds,
            turn.status === "running" ? turn.id : undefined,
          );
          return { checkpoint, turn };
        },
      );
      return reply.code(201).send({
        checkpoint: started.checkpoint,
        taskId: request.params.taskId,
        turn: started.turn,
      });
    },
  );

  app.post<{
    Body: SteerAgentTurnRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; turnId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns/:turnId/steer",
    {
      schema: {
        body: SteerAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTurnParamsSchema,
        response: {
          202: SteerAgentTurnResponseSchema,
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
        ["steer-turn", request.params.projectId, request.params.taskId, request.params.turnId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (request.body.taskId !== request.params.taskId) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const turn = task.turns.find((item) => item.id === request.params.turnId);
          if (turn === undefined) {
            throw new MutationHttpError("TURN_NOT_FOUND", "Turn not found", 404);
          }
          if (turn.status !== "running") {
            throw new MutationHttpError("TURN_NOT_RUNNING", "Turn is not running", 409);
          }

          const { attachmentIds, providerInput } = await resolveProviderTurnInput(
            request.params.projectId,
            request.body.input,
            context.provider,
            request.params.taskId,
          );
          await context.provider.steerTurn(
            request.params.taskId,
            request.params.turnId,
            providerInput,
          );
          // Provider 接受引导后才消费附件，失败时原请求仍可安全重试。
          await attachmentStore.consume(
            request.params.projectId,
            attachmentIds,
            request.params.turnId,
          );
          return {
            status: "accepted" as const,
            taskId: request.params.taskId,
            turnId: request.params.turnId,
          };
        },
      );
      return reply.code(202).send(response);
    },
  );

  app.post<{
    Body: { taskId: string };
    Headers: { "idempotency-key": string };
    Params: { projectId: string; taskId: string; turnId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/turns/:turnId/interrupt",
    {
      schema: {
        body: InterruptAgentTurnRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskTurnParamsSchema,
        response: {
          202: InterruptAgentTurnResponseSchema,
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
        ["interrupt-turn", request.params.projectId, request.params.taskId, request.params.turnId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (request.body.taskId !== request.params.taskId) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const context = await getProjectContext(request.params.projectId);
          if (context === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await context.provider.readTask(request.params.taskId);
          if (task?.projectId !== context.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }
          const turn = task.turns.find((item) => item.id === request.params.turnId);
          if (turn === undefined) {
            throw new MutationHttpError("TURN_NOT_FOUND", "Turn not found", 404);
          }
          if (turn.status !== "running") {
            throw new MutationHttpError("TURN_NOT_RUNNING", "Turn is not running", 409);
          }
          await context.provider.interruptTurn(request.params.taskId, request.params.turnId);
          return {
            status: "interrupting" as const,
            taskId: request.body.taskId,
            turnId: request.params.turnId,
          };
        },
      );
      return reply.code(202).send(response);
    },
  );

  app.post<{
    Body: ResolvePendingRequestRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string; requestId: string; taskId: string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/pending-requests/:requestId/resolve",
    {
      schema: {
        body: ResolvePendingRequestRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskPendingRequestParamsSchema,
        response: {
          200: ResolvePendingRequestResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      if (
        request.body.projectId !== request.params.projectId ||
        request.body.taskId !== request.params.taskId
      ) {
        throw new MutationHttpError(
          "PENDING_REQUEST_MISMATCH",
          "Pending request identity does not match",
          409,
        );
      }
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const task = await context.provider.readTask(request.params.taskId);
      if (task?.projectId !== context.scope.id) {
        throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
      }
      const resolvedRequest = await runIdempotent(
        [
          "resolve-pending-request",
          request.params.projectId,
          request.params.taskId,
          request.params.requestId,
        ],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return await context.provider.resolvePendingRequest({
              ...request.body,
              requestId: request.params.requestId,
            });
          } catch (error) {
            if (error instanceof PendingRequestResolutionError) {
              throw toPendingRequestHttpError(error);
            }
            throw error;
          }
        },
      );
      return { request: resolvedRequest };
    },
  );
  done();
};
