import {
  AgentMutationErrorSchema,
  DeleteScheduledTaskResponseSchema,
  ScheduledTaskInputSchema,
  ScheduledTaskMutationResponseSchema,
  ScheduledTaskPageSchema,
  ScheduledTaskPreviewSchema,
  ScheduledTaskPreviewRequestSchema,
  type ScheduledTaskPreviewRequest,
  SetScheduledTaskEnabledRequestSchema,
  type ScheduledTaskInput,
  type SetScheduledTaskEnabledRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";

import { ScheduledTaskServiceError } from "../scheduled-task-service.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { Type } from "@sinclair/typebox";
import { registerScheduledTaskEvents } from "./scheduled-task-events.js";
import { previewScheduledTask } from "../scheduled-task-runtime.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

interface MutationHeaders {
  "idempotency-key": string;
}

const ParamsSchema = Type.Object(
  { taskId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

function mapError(error: unknown): never {
  if (!(error instanceof ScheduledTaskServiceError)) throw error;
  if (error.code === "not_found") throw new MutationHttpError("TASK_NOT_FOUND", error.message, 404);
  throw new MutationHttpError("INVALID_REQUEST", error.message, error.code === "busy" ? 409 : 400);
}

export const registerScheduledTaskRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  registerScheduledTaskEvents(app, context);
  // 与其他写接口共享实例内幂等缓存；作用域区分操作和任务，缓存不跨 Server 重启。
  const run = <T>(
    scope: readonly string[],
    key: string,
    payload: unknown,
    action: () => Promise<T>,
  ) =>
    context.runIdempotent(scope, key, payload, async () => {
      try {
        return await action();
      } catch (error) {
        // 必须在 runner 转换通用错误前保留业务错误的 400/404/409 语义。
        mapError(error);
      }
    });
  const response = {
    400: AgentMutationErrorSchema,
    404: AgentMutationErrorSchema,
    409: AgentMutationErrorSchema,
    502: AgentMutationErrorSchema,
    503: AgentMutationErrorSchema,
  };
  app.post<{ Body: ScheduledTaskPreviewRequest }>(
    "/v1/scheduled-tasks/preview",
    {
      schema: {
        body: ScheduledTaskPreviewRequestSchema,
        response: { 200: ScheduledTaskPreviewSchema, 400: AgentMutationErrorSchema },
      },
    },
    async (request) => {
      try {
        return { dates: await previewScheduledTask(request.body.schedule, Date.now()) };
      } catch (error) {
        throw new MutationHttpError(
          "INVALID_REQUEST",
          error instanceof Error ? error.message : String(error),
          400,
        );
      }
    },
  );
  app.get(
    "/v1/scheduled-tasks",
    { schema: { response: { 200: ScheduledTaskPageSchema } } },
    async () => ({ data: await context.scheduledTaskService.list() }),
  );
  app.post<{ Body: ScheduledTaskInput; Headers: MutationHeaders }>(
    "/v1/scheduled-tasks",
    {
      schema: {
        body: ScheduledTaskInputSchema,
        headers: IdempotencyHeadersSchema,
        response: { ...response, 201: ScheduledTaskMutationResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await run(
        ["create-scheduled-task"],
        request.headers["idempotency-key"],
        request.body,
        async () => ({ task: await context.scheduledTaskService.create(request.body) }),
      );
      return reply.code(201).send(result);
    },
  );
  app.put<{ Body: ScheduledTaskInput; Params: { taskId: string }; Headers: MutationHeaders }>(
    "/v1/scheduled-tasks/:taskId",
    {
      schema: {
        body: ScheduledTaskInputSchema,
        headers: IdempotencyHeadersSchema,
        params: ParamsSchema,
        response: { ...response, 200: ScheduledTaskMutationResponseSchema },
      },
    },
    (request) =>
      run(
        ["update-scheduled-task", request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => ({
          task: await context.scheduledTaskService.update(request.params.taskId, request.body),
        }),
      ),
  );
  app.delete<{ Params: { taskId: string }; Headers: MutationHeaders }>(
    "/v1/scheduled-tasks/:taskId",
    {
      schema: {
        params: ParamsSchema,
        headers: IdempotencyHeadersSchema,
        response: { ...response, 200: DeleteScheduledTaskResponseSchema },
      },
    },
    (request) =>
      run(
        ["delete-scheduled-task", request.params.taskId],
        request.headers["idempotency-key"],
        {},
        async () => {
          await context.scheduledTaskService.delete(request.params.taskId);
          return { status: "deleted" as const, taskId: request.params.taskId };
        },
      ),
  );
  app.patch<{
    Body: SetScheduledTaskEnabledRequest;
    Params: { taskId: string };
    Headers: MutationHeaders;
  }>(
    "/v1/scheduled-tasks/:taskId/enabled",
    {
      schema: {
        body: SetScheduledTaskEnabledRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ParamsSchema,
        response: { ...response, 200: ScheduledTaskMutationResponseSchema },
      },
    },
    (request) =>
      run(
        ["set-scheduled-task-enabled", request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => ({
          task: await context.scheduledTaskService.setEnabled(
            request.params.taskId,
            request.body.enabled,
          ),
        }),
      ),
  );
  app.post<{ Params: { taskId: string }; Headers: MutationHeaders }>(
    "/v1/scheduled-tasks/:taskId/run",
    {
      schema: {
        params: ParamsSchema,
        headers: IdempotencyHeadersSchema,
        response: { ...response, 200: ScheduledTaskMutationResponseSchema },
      },
    },
    (request) =>
      run(
        ["run-scheduled-task", request.params.taskId],
        request.headers["idempotency-key"],
        {},
        async () => ({ task: await context.scheduledTaskService.runNow(request.params.taskId) }),
      ),
  );
  done();
};
