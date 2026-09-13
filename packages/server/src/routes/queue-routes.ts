import {
  AddAgentQueuedSubmissionRequestSchema,
  AddAgentQueuedSubmissionResponseSchema,
  AgentMutationErrorSchema,
  AgentQueuedSubmissionListSchema,
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
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";

import { TaskQueueBlockedError, TaskQueueItemNotFoundError } from "../persistent-task-queue.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  IdempotencyHeadersSchema,
  ProjectTaskParamsSchema,
  ProjectTaskQueueParamsSchema,
} from "./schemas.js";

interface TaskParams {
  projectId: string;
  taskId: string;
}

interface QueueParams extends TaskParams {
  queuedSubmissionId: string;
}

function toQueueHttpError(error: unknown): never {
  if (error instanceof TaskQueueBlockedError) {
    throw new MutationHttpError("TURN_NOT_RUNNING", error.message, 409);
  }
  if (error instanceof TaskQueueItemNotFoundError) {
    throw new MutationHttpError("TASK_NOT_FOUND", error.message, 404);
  }
  throw error;
}

export const registerQueueRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { getProjectContext, runIdempotent, taskQueue } = context;

  const readQueue = async (params: TaskParams) => {
    const projectContext = await getProjectContext(params.projectId);
    if (projectContext === undefined) {
      throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
    }
    const task = await projectContext.provider.readTask(params.taskId);
    if (task?.projectId !== projectContext.scope.id) {
      throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
    }
    return {
      eventStream: projectContext.eventStream,
      projectId: params.projectId,
      provider: projectContext.provider,
      taskId: params.taskId,
    };
  };

  app.get<{ Params: TaskParams }>(
    "/v1/projects/:projectId/tasks/:taskId/queue",
    {
      schema: {
        params: ProjectTaskParamsSchema,
        response: { 200: AgentQueuedSubmissionListSchema, 404: AgentMutationErrorSchema },
      },
    },
    async (request) => {
      const runtime = await readQueue(request.params);
      return { data: await taskQueue.list(runtime) };
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
      const runtime = await readQueue(request.params);
      const queuedSubmission = await runIdempotent(
        ["queue-add", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        () => taskQueue.add(runtime, request.body.input, request.body.clientUserMessageId),
      );
      return reply.code(201).send({
        queue: { data: await taskQueue.list(runtime) },
        queuedSubmission,
      });
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
        response: {
          200: UpdateAgentQueuedSubmissionResponseSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const runtime = await readQueue(request.params);
      const queuedSubmission = await runIdempotent(
        ["queue-update", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        { ...request.body, queuedSubmissionId: request.params.queuedSubmissionId },
        () =>
          taskQueue
            .update(
              runtime,
              request.params.queuedSubmissionId,
              request.body.input,
              request.body.status,
            )
            .catch(toQueueHttpError),
      );
      return { queue: { data: await taskQueue.list(runtime) }, queuedSubmission };
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
      const runtime = await readQueue(request.params);
      const deleted = await runIdempotent(
        ["queue-delete", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        { queuedSubmissionId: request.params.queuedSubmissionId },
        () => taskQueue.delete(runtime, request.params.queuedSubmissionId),
      );
      return { deleted, queue: { data: await taskQueue.list(runtime) } };
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
      const runtime = await readQueue(request.params);
      await runIdempotent(
        ["queue-reorder", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          await taskQueue.reorder(runtime, request.body.queuedSubmissionIds);
          return { status: "reordered" as const };
        },
      );
      return { queue: { data: await taskQueue.list(runtime) }, status: "reordered" as const };
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
      const runtime = await readQueue(request.params);
      const turn = await runIdempotent(
        ["queue-start", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return await taskQueue.start(runtime, request.body.queuedSubmissionId);
          } catch (error) {
            toQueueHttpError(error);
          }
        },
      );
      return reply.code(201).send({
        queue: { data: await taskQueue.list(runtime) },
        taskId: request.params.taskId,
        turn,
      });
    },
  );

  done();
};
