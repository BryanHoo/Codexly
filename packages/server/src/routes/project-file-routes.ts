import {
  AgentAttachmentUploadResponseSchema,
  AgentMutationErrorSchema,
  ImportHostAttachmentRequestSchema,
  ProjectFileTreeQuerySchema,
  ProjectFileTreeSchema,
  ProjectFileSearchPageSchema,
  ProjectFileSearchQuerySchema,
  ProjectSourceFileQuerySchema,
  ProjectSourceFileSchema,
  StopProjectFileSearchRequestSchema,
  StopProjectFileSearchResponseSchema,
  type AgentAttachmentKind,
  type ImportHostAttachmentRequest,
  type ProjectFileTreeQuery,
  type ProjectFileSearchQuery,
  type ProjectSourceFileQuery,
  type StopProjectFileSearchRequest,
  TEMPORARY_TASK_SCOPE_ID,
} from "@codexly/protocol";
import type { ProjectRepository } from "@codexly/core";
import { AttachmentNotFoundError, type StoredAttachmentUpload } from "../attachment-store.js";
import { HostFileBrowserError } from "../host-file-browser.js";
import { ProjectRootScopeError, resolveProjectRootEntry } from "../project-root-scope.js";
import { filterProjectFileSearchMatches } from "../project-file-search.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectAttachmentParamsSchema,
  ProjectHostAttachmentParamsSchema,
  ProjectParamsSchema,
  ProjectStoredAttachmentParamsSchema,
} from "./schemas.js";

import type { FastifyInstance, FastifyReply } from "fastify";

async function resolveReadRoot(
  repository: ProjectRepository,
  getProjectContext: ServerRouteContext["getProjectContext"],
  projectId: string,
  rootPath: string | undefined,
  reply: FastifyReply,
): Promise<Readonly<{ id: string; path: string }> | undefined> {
  try {
    return await resolveProjectFileRoot(repository, getProjectContext, projectId, rootPath);
  } catch (error) {
    if (error instanceof ProjectRootScopeError) {
      const status = error.code === "PROJECT_NOT_FOUND" ? 404 : 400;
      await reply.code(status).send({ code: error.code, message: error.message });
      return undefined;
    }
    throw error;
  }
}

async function resolveProjectFileRoot(
  repository: ProjectRepository,
  getProjectContext: ServerRouteContext["getProjectContext"],
  projectId: string,
  rootPath: string | undefined,
): Promise<Readonly<{ id: string; path: string }>> {
  if (projectId === TEMPORARY_TASK_SCOPE_ID) {
    const temporaryRoot = (await getProjectContext(projectId))?.scope.rootPath;
    if (temporaryRoot === undefined) {
      throw new ProjectRootScopeError("PROJECT_NOT_FOUND", "Project not found");
    }
    return { id: TEMPORARY_TASK_SCOPE_ID, path: temporaryRoot };
  }
  if (rootPath === undefined) {
    throw new ProjectRootScopeError("PROJECT_ROOT_INVALID", "Project root is required");
  }
  return resolveProjectRootEntry(repository, projectId, rootPath);
}

export function registerProjectFileRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const {
    attachmentStore,
    getProjectContext,
    maximumAttachmentBytes,
    multipartEnvelopeBytes,
    projectRepository,
    readFileTree,
    searchProjectFiles,
    readImageFile,
    readSourceFile,
    runIdempotent,
    resolveHostAttachment,
    stopProjectFileSearch,
  } = context;

  app.get<{ Params: { projectId: string }; Querystring: ProjectFileTreeQuery }>(
    "/v1/projects/:projectId/files/tree",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectFileTreeQuerySchema,
        response: {
          200: ProjectFileTreeSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const root = await resolveReadRoot(
        projectRepository,
        getProjectContext,
        request.params.projectId,
        request.query.rootPath,
        reply,
      );
      if (root === undefined) return;
      try {
        return await readFileTree(root.path, request.query.path);
      } catch {
        // 文件系统错误在交付边界收敛，响应不泄露 Project 的本机路径。
        return reply.code(500).send({
          code: "PROJECT_FILE_TREE_UNAVAILABLE",
          message: "Project file tree is unavailable",
        });
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: ProjectFileSearchQuery }>(
    "/v1/projects/:projectId/files/search",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectFileSearchQuerySchema,
        response: {
          200: ProjectFileSearchPageSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const root = await resolveReadRoot(
        projectRepository,
        getProjectContext,
        request.params.projectId,
        request.query.rootPath,
        reply,
      );
      if (root === undefined) return;
      try {
        const page = await searchProjectFiles({
          projectId: request.params.projectId,
          query: request.query.query,
          roots: [root.path],
          sessionId: request.query.sessionId,
          signal: request.signal,
        });
        const filteredPage = await filterProjectFileSearchMatches(root.path, page);
        return {
          data: filteredPage.data.map((entry) => ({
            name: entry.name,
            path: entry.path,
            rootId: root.id,
            rootPath: root.path,
          })),
        };
      } catch (error) {
        if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
        return reply.code(500).send({
          code: "PROJECT_FILE_SEARCH_UNAVAILABLE",
          message: "Project file search is unavailable",
        });
      }
    },
  );

  app.post<{
    Body: StopProjectFileSearchRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/files/search/stop",
    {
      schema: {
        body: StopProjectFileSearchRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: StopProjectFileSearchResponseSchema,
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
        ["project-file-search-stop", request.params.projectId, request.body.sessionId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            await resolveProjectFileRoot(
              projectRepository,
              getProjectContext,
              request.params.projectId,
              request.body.rootPath,
            );
          } catch (error) {
            if (error instanceof ProjectRootScopeError) {
              throw new MutationHttpError(
                error.code === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : "INVALID_REQUEST",
                error.message,
                error.code === "PROJECT_NOT_FOUND" ? 404 : 400,
              );
            }
            throw error;
          }
          try {
            await stopProjectFileSearch(request.params.projectId, request.body.sessionId);
          } catch {
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              "Project file search is unavailable",
              502,
              true,
            );
          }
          return {};
        },
      ),
  );

  app.get<{ Params: { projectId: string }; Querystring: ProjectSourceFileQuery }>(
    "/v1/projects/:projectId/files/image",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectSourceFileQuerySchema,
        response: { 400: ErrorResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const root = await resolveReadRoot(
        projectRepository,
        getProjectContext,
        request.params.projectId,
        request.query.rootPath,
        reply,
      );
      if (root === undefined) return;
      try {
        const image = await readImageFile(root.path, request.query.path);
        return await reply
          .header("cache-control", "private, max-age=60")
          .header("x-content-type-options", "nosniff")
          .type(image.mediaType)
          .send(image.content);
      } catch {
        // 路径不可读、文件超限和签名错误统一隐藏，不向页面泄露具体文件系统状态。
        return reply.code(404).send({
          code: "PROJECT_IMAGE_NOT_FOUND",
          message: "Project image is unavailable",
        });
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: ProjectSourceFileQuery }>(
    "/v1/projects/:projectId/files/source",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectSourceFileQuerySchema,
        response: {
          200: ProjectSourceFileSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const root = await resolveReadRoot(
        projectRepository,
        getProjectContext,
        request.params.projectId,
        request.query.rootPath,
        reply,
      );
      if (root === undefined) return;
      try {
        return await readSourceFile(root.path, request.query.path, request.query.cursor ?? 0);
      } catch {
        // 路径不可读、文件不存在和二进制内容统一隐藏为不可预览。
        return reply.code(404).send({
          code: "SOURCE_FILE_NOT_FOUND",
          message: "Source file is unavailable",
        });
      }
    },
  );

  app.post<{
    Body: ImportHostAttachmentRequest;
    Headers: { "idempotency-key": string };
    Params: { kind: "file" | "image"; projectId: string };
  }>(
    "/v1/projects/:projectId/attachments/:kind/host",
    {
      schema: {
        body: ImportHostAttachmentRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectHostAttachmentParamsSchema,
        response: {
          201: AgentAttachmentUploadResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          413: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }

      let upload: StoredAttachmentUpload | undefined;
      try {
        const source = await resolveHostAttachment(request.params.kind, request.body.path);
        upload = await attachmentStore.add(request.params.projectId, source);
        const currentUpload = upload;
        const attachment = await runIdempotent(
          ["import-host-attachment", request.params.projectId],
          request.headers["idempotency-key"],
          {
            contentDigest: upload.contentDigest,
            kind: upload.attachment.kind,
            mediaType: upload.attachment.mediaType,
            name: upload.attachment.name,
            size: upload.attachment.size,
          },
          () => currentUpload.attachment,
        );
        if (attachment.id !== upload.attachment.id) {
          await attachmentStore.discard(upload.attachment.id);
        }
        return await reply.code(201).send({ attachment });
      } catch (error) {
        if (upload !== undefined) {
          await attachmentStore.discard(upload.attachment.id);
        }
        if (error instanceof RangeError) {
          throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
        }
        if (error instanceof HostFileBrowserError || error instanceof TypeError) {
          throw new MutationHttpError("INVALID_REQUEST", "Host attachment is invalid", 400);
        }
        throw error;
      }
    },
  );

  app.post<{
    Headers: { "idempotency-key": string };
    Params: { kind: AgentAttachmentKind; projectId: string };
  }>(
    "/v1/projects/:projectId/attachments/:kind",
    {
      schema: {
        headers: IdempotencyHeadersSchema,
        params: ProjectAttachmentParamsSchema,
        response: {
          201: AgentAttachmentUploadResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          413: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const maximumBytes = maximumAttachmentBytes(request.params.kind);
      const contentLength = Number(request.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > maximumBytes + multipartEnvelopeBytes) {
        throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
      }
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      if (!request.isMultipart()) {
        throw new MutationHttpError(
          "INVALID_REQUEST",
          "Attachment must use multipart/form-data",
          400,
        );
      }

      let upload: StoredAttachmentUpload | undefined;
      try {
        const part = await request.file({
          limits: { fields: 0, files: 1, fileSize: maximumBytes, parts: 1 },
        });
        if (part?.fieldname !== "attachment") {
          throw new TypeError("Attachment file part is missing");
        }
        upload = await attachmentStore.add(request.params.projectId, {
          content: part.file,
          kind: request.params.kind,
          mediaType: part.mimetype,
          name: part.filename,
        });
        if (part.file.truncated) {
          throw new RangeError("Attachment exceeds the maximum size");
        }
        const currentUpload = upload;
        const attachment = await runIdempotent(
          ["upload-attachment", request.params.projectId],
          request.headers["idempotency-key"],
          {
            contentDigest: upload.contentDigest,
            kind: request.params.kind,
            mediaType: upload.attachment.mediaType,
            name: upload.attachment.name,
            size: upload.attachment.size,
          },
          () => currentUpload.attachment,
        );
        if (attachment.id !== upload.attachment.id) {
          await attachmentStore.discard(upload.attachment.id);
        }
        return await reply.code(201).send({ attachment });
      } catch (error) {
        if (upload !== undefined) {
          await attachmentStore.discard(upload.attachment.id);
        }
        if (
          error instanceof RangeError ||
          error instanceof app.multipartErrors.RequestFileTooLargeError
        ) {
          throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
        }
        if (error instanceof TypeError) {
          throw new MutationHttpError("INVALID_REQUEST", "Attachment is invalid", 400);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { attachmentId: string; projectId: string } }>(
    "/v1/projects/:projectId/attachments/:attachmentId",
    {
      schema: {
        params: ProjectStoredAttachmentParamsSchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const stored = await attachmentStore.read(
          request.params.projectId,
          request.params.attachmentId,
        );
        return await reply
          .header("x-content-type-options", "nosniff")
          .type(stored.attachment.mediaType)
          .send(stored.content);
      } catch (error) {
        if (error instanceof AttachmentNotFoundError) {
          return reply
            .code(404)
            .send({ code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" });
        }
        throw error;
      }
    },
  );
}
