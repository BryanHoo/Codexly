import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

import {
  AgentMutationErrorSchema,
  OpenAgentTaskAttachmentRequestSchema,
  OpenAgentTaskAttachmentResponseSchema,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";

import { AttachmentNotFoundError } from "../attachment-store.js";
import { ProjectOpenAppUnavailableError, ProjectOpenTargetInvalidError } from "../project-open.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectTaskAttachmentParamsSchema,
} from "./schemas.js";

interface TaskAttachmentParams {
  attachmentId: string;
  projectId: string;
  taskId: string;
}

export function registerTaskAttachmentRoutes(
  app: FastifyInstance,
  { attachmentStore, getProjectContext, projectOpenService, runIdempotent }: ServerRouteContext,
): void {
  app.get<{ Params: TaskAttachmentParams }>(
    "/v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId",
    {
      schema: {
        params: ProjectTaskAttachmentParamsSchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      let attachment = await context.provider.readTaskAttachment(
        request.params.taskId,
        request.params.attachmentId,
      );
      if (attachment === undefined) {
        const task = await context.provider.readTask(request.params.taskId);
        if (task?.projectId !== context.scope.id) {
          return reply.code(404).send({ code: "TASK_NOT_FOUND", message: "Task not found" });
        }
        try {
          // Provider 历史尚未同步时，继续交付本次 Turn 保留的上传内容。
          const stored = await attachmentStore.readSubmitted(
            request.params.projectId,
            request.params.attachmentId,
          );
          attachment = { ...stored.attachment, content: stored.content };
        } catch (error) {
          if (error instanceof AttachmentNotFoundError) {
            return reply
              .code(404)
              .send({ code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" });
          }
          throw error;
        }
      }
      // 随机 ID 已绑定 Project/Task；响应只交付已复验的附件正文，不暴露本地路径。
      return reply
        .header("cache-control", "private, max-age=300")
        .header("x-content-type-options", "nosniff")
        .type(attachment.mediaType)
        .send(Buffer.from(attachment.content));
    },
  );

  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: TaskAttachmentParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId/open",
    {
      schema: {
        body: OpenAgentTaskAttachmentRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskAttachmentParamsSchema,
        response: {
          200: OpenAgentTaskAttachmentResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        [
          "open-task-attachment",
          request.params.projectId,
          request.params.taskId,
          request.params.attachmentId,
        ],
        request.headers["idempotency-key"],
        {},
        async () => {
          const projectContext = await getProjectContext(request.params.projectId);
          if (projectContext === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          const task = await projectContext.provider.readTask(request.params.taskId);
          if (task?.projectId !== projectContext.scope.id) {
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          }

          let attachment = await projectContext.provider.readTaskAttachment(
            request.params.taskId,
            request.params.attachmentId,
          );
          let attachmentKind = task.turns
            .flatMap((turn) => turn.items)
            .filter((item) => item.type === "message")
            .flatMap((item) => item.attachments ?? [])
            .find((item) => item.id === request.params.attachmentId)?.kind;
          if (attachment === undefined) {
            try {
              const stored = await attachmentStore.readSubmitted(
                request.params.projectId,
                request.params.attachmentId,
              );
              attachment = { ...stored.attachment, content: stored.content };
              attachmentKind = stored.attachment.kind;
            } catch (error) {
              if (error instanceof AttachmentNotFoundError) {
                throw new MutationHttpError("INVALID_REQUEST", "Attachment not found", 404);
              }
              throw error;
            }
          }
          if (attachmentKind !== "file") {
            throw new MutationHttpError("INVALID_REQUEST", "Attachment cannot be opened", 400);
          }

          try {
            // 系统应用只接收 Server 管理的短期副本，原始附件路径始终不进入 Web 契约。
            const copy = await attachmentStore.add(request.params.projectId, {
              content: Readable.from([Buffer.from(attachment.content)]),
              kind: "file",
              mediaType: attachment.mediaType,
              name: attachment.name,
            });
            const [resolved] = await attachmentStore.resolve(request.params.projectId, [
              copy.attachment.id,
            ]);
            if (resolved?.kind !== "file") {
              throw new TypeError("Attachment copy is not a file");
            }
            await projectOpenService.open(
              projectContext.scope.rootPath,
              "system-default",
              resolved.path,
            );
          } catch (error) {
            if (error instanceof ProjectOpenAppUnavailableError) {
              throw new MutationHttpError(
                "INVALID_REQUEST",
                "System application is unavailable",
                409,
              );
            }
            if (error instanceof ProjectOpenTargetInvalidError || error instanceof TypeError) {
              throw new MutationHttpError("INVALID_REQUEST", "Attachment cannot be opened", 400);
            }
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              "Attachment could not be opened",
              502,
              true,
            );
          }
          return { attachmentId: request.params.attachmentId, status: "opened" as const };
        },
      ),
  );
}
