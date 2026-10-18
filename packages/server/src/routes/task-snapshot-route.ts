import { AgentMutationErrorSchema, AgentTaskSnapshotResponseSchema } from "@codexly/protocol";
import { readTaskWithCheckpoint, TaskSnapshotBusyError } from "@codexly/core";
import type { FastifyInstance } from "fastify";
import { restorePersistedAsyncQuestionAnswers } from "../async-question-snapshot.js";
import type { ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  ProjectTaskParamsSchema,
  TaskSnapshotQuerySchema,
} from "./schemas.js";

export function registerTaskSnapshotRoute(app: FastifyInstance, context: ServerRouteContext): void {
  const { getProjectContext, readEffectiveTaskSettings } = context;
  app.get<{
    Params: { projectId: string; taskId: string };
    Querystring: { cursor?: string; summary?: boolean };
  }>(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      errorHandler(error, _request, reply) {
        // Fastify 先发送超时响应再协作取消；本路由统一交付可识别的暂时繁忙语义。
        if (error instanceof Error && "code" in error && error.code === "FST_ERR_HANDLER_TIMEOUT") {
          const busy = new TaskSnapshotBusyError();
          reply.code(503).send({ code: busy.code, message: busy.message, retryable: true });
          return;
        }
        reply.send(error);
      },
      schema: {
        params: ProjectTaskParamsSchema,
        querystring: TaskSnapshotQuerySchema,
        response: {
          200: AgentTaskSnapshotResponseSchema,
          404: ErrorResponseSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const projectContext = await getProjectContext(request.params.projectId);
      if (projectContext === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      const read = await readTaskWithCheckpoint(
        projectContext.provider,
        request.params.taskId,
        {
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.summary === undefined ? {} : { summary: request.query.summary }),
          // Fastify 超时仅协作取消，必须传入读取与后续 RPC，避免响应结束后继续重读。
          signal: request.signal,
        },
        () => projectContext.eventStream.checkpoint,
      );
      if (read === undefined || read.snapshot.projectId !== projectContext.scope.id) {
        return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
      }
      request.signal.throwIfAborted();
      const task = await restorePersistedAsyncQuestionAnswers(
        context,
        request.params.projectId,
        request.params.taskId,
        read.snapshot,
      );
      // 后续持久化答案和设置读取不推进覆盖边界；期间事件仍由该 checkpoint 回放。
      request.signal.throwIfAborted();
      const checkpoint = read.checkpoint;
      const settings = await readEffectiveTaskSettings(
        request.params.projectId,
        request.params.taskId,
      );
      request.signal.throwIfAborted();
      return { checkpoint, snapshot: { ...task, settings } };
    },
  );
}
