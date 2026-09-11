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
  const response = {
    400: AgentMutationErrorSchema,
    404: AgentMutationErrorSchema,
    409: AgentMutationErrorSchema,
  };
  app.post<{ Body: ScheduledTaskPreviewRequest }>(
    "/v1/scheduled-tasks/preview",
    {
      schema: {
        body: ScheduledTaskPreviewRequestSchema,
        response: { 200: ScheduledTaskPreviewSchema, 400: AgentMutationErrorSchema },
      },
    },
    (request) => {
      try {
        return { dates: previewScheduledTask(request.body.schedule, Date.now()) };
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
  app.post<{ Body: ScheduledTaskInput }>(
    "/v1/scheduled-tasks",
    {
      schema: {
        body: ScheduledTaskInputSchema,
        response: { ...response, 201: ScheduledTaskMutationResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await reply
          .code(201)
          .send({ task: await context.scheduledTaskService.create(request.body) });
      } catch (error) {
        mapError(error);
      }
    },
  );
  app.put<{ Body: ScheduledTaskInput; Params: { taskId: string } }>(
    "/v1/scheduled-tasks/:taskId",
    {
      schema: {
        body: ScheduledTaskInputSchema,
        params: ParamsSchema,
        response: { ...response, 200: ScheduledTaskMutationResponseSchema },
      },
    },
    async (request) => {
      try {
        return {
          task: await context.scheduledTaskService.update(request.params.taskId, request.body),
        };
      } catch (error) {
        mapError(error);
      }
    },
  );
  app.delete<{ Params: { taskId: string } }>(
    "/v1/scheduled-tasks/:taskId",
    {
      schema: {
        params: ParamsSchema,
        response: { ...response, 200: DeleteScheduledTaskResponseSchema },
      },
    },
    async (request) => {
      try {
        await context.scheduledTaskService.delete(request.params.taskId);
        return { status: "deleted" as const, taskId: request.params.taskId };
      } catch (error) {
        mapError(error);
      }
    },
  );
  app.patch<{ Body: SetScheduledTaskEnabledRequest; Params: { taskId: string } }>(
    "/v1/scheduled-tasks/:taskId/enabled",
    {
      schema: {
        body: SetScheduledTaskEnabledRequestSchema,
        params: ParamsSchema,
        response: { ...response, 200: ScheduledTaskMutationResponseSchema },
      },
    },
    async (request) => {
      try {
        return {
          task: await context.scheduledTaskService.setEnabled(
            request.params.taskId,
            request.body.enabled,
          ),
        };
      } catch (error) {
        mapError(error);
      }
    },
  );
  app.post<{ Params: { taskId: string } }>(
    "/v1/scheduled-tasks/:taskId/run",
    {
      schema: {
        params: ParamsSchema,
        response: { ...response, 200: ScheduledTaskMutationResponseSchema },
      },
    },
    async (request) => {
      try {
        return { task: await context.scheduledTaskService.runNow(request.params.taskId) };
      } catch (error) {
        mapError(error);
      }
    },
  );
  done();
};
