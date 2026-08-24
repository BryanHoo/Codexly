import {
  AddAgentQueuedSubmissionRequestSchema,
  AddAgentQueuedSubmissionResponseSchema,
  AgentMutationErrorSchema,
  AgentQueuedSubmissionPageSchema,
  DeleteAgentQueuedSubmissionResponseSchema,
  ReorderAgentQueuedSubmissionsRequestSchema,
  ReorderAgentQueuedSubmissionsResponseSchema,
  StartAgentQueuedSubmissionRequestSchema,
  StartAgentQueuedSubmissionResponseSchema,
  UpdateAgentQueuedSubmissionRequestSchema,
  UpdateAgentQueuedSubmissionResponseSchema,
  type AddAgentQueuedSubmissionRequest,
  type ReorderAgentQueuedSubmissionsRequest,
  type StartAgentQueuedSubmissionRequest,
  type UpdateAgentQueuedSubmissionRequest,
} from "@code-agent/protocol";
import type { AgentProvider } from "@code-agent/core";
import type { FastifyPluginCallback } from "fastify";

import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  IdempotencyHeadersSchema,
  ProjectTaskParamsSchema,
  ProjectTaskQueueParamsSchema,
  QueuePageQuerySchema,
} from "./schemas.js";

interface TaskParams {
  projectId: string;
  taskId: string;
}

interface QueueParams extends TaskParams {
  queuedSubmissionId: string;
}

export const registerQueueRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { attachmentStore, getProjectContext, resolveProviderTurnInput, runIdempotent } = context;

  const readQueue = async (
    params: TaskParams,
  ): Promise<Readonly<{ provider: AgentProvider; queue: NonNullable<AgentProvider["queue"]> }>> => {
    const projectContext = await getProjectContext(params.projectId);
    if (projectContext === undefined) {
      throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
    }
    const task = await projectContext.provider.readTask(params.taskId);
    if (task?.projectId !== projectContext.scope.id) {
      throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
    }
    if (projectContext.provider.queue === undefined) {
      throw new MutationHttpError("PROVIDER_ERROR", "Task queue is unavailable", 503);
    }
    return { provider: projectContext.provider, queue: projectContext.provider.queue };
  };

  app.get<{
    Params: TaskParams;
    Querystring: { cursor?: string; limit?: number };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/queue",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        querystring: QueuePageQuerySchema,
        response: { 200: AgentQueuedSubmissionPageSchema, 404: AgentMutationErrorSchema },
      },
    },
    async (request) => {
      const { queue } = await readQueue(request.params);
      return queue.list(request.params.taskId, {
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
      });
    },
  );

  app.post<{
    Body: AddAgentQueuedSubmissionRequest;
    Headers: { "idempotency-key": string };
    Params: TaskParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/queue",
    {
      schema: {
        body: AddAgentQueuedSubmissionRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 201: AddAgentQueuedSubmissionResponseSchema, 400: AgentMutationErrorSchema },
      },
    },
    async (request, reply) => {
      const queuedSubmission = await runIdempotent(
        ["queue-add", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const { provider, queue } = await readQueue(request.params);
          const { attachmentIds, providerInput } = await resolveProviderTurnInput(
            request.params.projectId,
            request.body.input,
            provider,
            request.params.taskId,
          );
          const queuedSubmission = await queue.add(
            request.params.taskId,
            providerInput,
            request.body.clientUserMessageId,
          );
          await attachmentStore.retainQueue(
            request.params.projectId,
            attachmentIds,
            queuedSubmission.id,
          );
          return queuedSubmission;
        },
      );
      return reply.code(201).send({ queuedSubmission });
    },
  );

  app.put<{
    Body: UpdateAgentQueuedSubmissionRequest;
    Headers: { "idempotency-key": string };
    Params: QueueParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/queue/:queuedSubmissionId",
    {
      schema: {
        body: UpdateAgentQueuedSubmissionRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskQueueParamsSchema,
        response: { 200: UpdateAgentQueuedSubmissionResponseSchema },
      },
    },
    async (request) => {
      const queuedSubmission = await runIdempotent(
        ["queue-update", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        { ...request.body, queuedSubmissionId: request.params.queuedSubmissionId },
        async () => {
          const { provider, queue } = await readQueue(request.params);
          const { attachmentIds, providerInput } = await resolveProviderTurnInput(
            request.params.projectId,
            request.body.input,
            provider,
            request.params.taskId,
          );
          const queuedSubmission = await queue.update(
            request.params.taskId,
            request.params.queuedSubmissionId,
            providerInput,
          );
          await attachmentStore.releaseQueue(
            request.params.projectId,
            request.params.queuedSubmissionId,
          );
          await attachmentStore.retainQueue(
            request.params.projectId,
            attachmentIds,
            queuedSubmission.id,
          );
          return queuedSubmission;
        },
      );
      return { queuedSubmission };
    },
  );

  app.delete<{
    Headers: { "idempotency-key": string };
    Params: QueueParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/queue/:queuedSubmissionId",
    {
      schema: {
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskQueueParamsSchema,
        response: { 200: DeleteAgentQueuedSubmissionResponseSchema },
      },
    },
    async (request) => {
      const deleted = await runIdempotent(
        ["queue-delete", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        { queuedSubmissionId: request.params.queuedSubmissionId },
        async () => {
          const { queue } = await readQueue(request.params);
          const deleted = await queue.delete(
            request.params.taskId,
            request.params.queuedSubmissionId,
          );
          if (deleted) {
            await attachmentStore.releaseQueue(
              request.params.projectId,
              request.params.queuedSubmissionId,
            );
          }
          return deleted;
        },
      );
      return { deleted };
    },
  );

  app.put<{
    Body: ReorderAgentQueuedSubmissionsRequest;
    Headers: { "idempotency-key": string };
    Params: TaskParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/queue/reorder",
    {
      schema: {
        body: ReorderAgentQueuedSubmissionsRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 200: ReorderAgentQueuedSubmissionsResponseSchema },
      },
    },
    async (request) => {
      await runIdempotent(
        ["queue-reorder", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const { queue } = await readQueue(request.params);
          await queue.reorder(request.params.taskId, request.body.queuedSubmissionIds);
          return { status: "reordered" as const };
        },
      );
      return { status: "reordered" as const };
    },
  );

  app.post<{
    Body: StartAgentQueuedSubmissionRequest;
    Headers: { "idempotency-key": string };
    Params: TaskParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/queue/start",
    {
      schema: {
        body: StartAgentQueuedSubmissionRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskParamsSchema,
        response: { 201: StartAgentQueuedSubmissionResponseSchema },
      },
    },
    async (request, reply) => {
      const turn = await runIdempotent(
        ["queue-start", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const { queue } = await readQueue(request.params);
          const queuedSubmissionId =
            request.body.queuedSubmissionId ??
            (await queue.list(request.params.taskId)).data[0]?.id;
          const turn = await queue.start(request.params.taskId, queuedSubmissionId);
          if (queuedSubmissionId !== undefined) {
            await attachmentStore.startQueue(request.params.projectId, queuedSubmissionId, turn.id);
          }
          return turn;
        },
      );
      return reply.code(201).send({ taskId: request.params.taskId, turn });
    },
  );

  done();
};
