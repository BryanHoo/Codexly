import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AgentMutationErrorSchema,
  MAX_TEXT_FILE_BYTES,
  ProjectTextFileSchema,
  ProjectSourceFileQuerySchema,
  ProjectRootQuerySchema,
  SaveProjectTextFileRequestSchema,
  SaveProjectTextFileResponseSchema,
  type ProjectSourceFileQuery,
  type ProjectRootQuery,
  type SaveProjectTextFileRequest,
} from "@codexly/protocol";
import { readProjectTextFile, saveProjectTextFile, TextFileError } from "../project-text-file.js";
import { ProjectRootScopeError } from "../project-root-scope.js";
import { ProjectParamsSchema } from "./schemas.js";

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof TextFileError)
    return reply
      .code(error.code === "TEXT_FILE_CONFLICT" ? 409 : 400)
      .send({ code: error.code, message: error.message, retryable: false });
  if (error instanceof ProjectRootScopeError)
    return reply
      .code(error.code === "PROJECT_NOT_FOUND" ? 404 : 400)
      .send({ code: error.code, message: error.message, retryable: false });
  // 不把文件系统绝对路径或操作系统错误返回到网络边界。
  return reply
    .code(404)
    .send({ code: "TEXT_FILE_UNAVAILABLE", message: "Text file is unavailable", retryable: false });
}

export function registerProjectTextFileRoutes(
  app: FastifyInstance,
  resolveRoot: (id: string, root?: string) => Promise<{ id: string; path: string }>,
): void {
  const errors = {
    400: AgentMutationErrorSchema,
    404: AgentMutationErrorSchema,
    409: AgentMutationErrorSchema,
  };
  app.get<{ Params: { projectId: string }; Querystring: ProjectSourceFileQuery }>(
    "/v1/projects/:projectId/files/text",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectSourceFileQuerySchema,
        response: { 200: ProjectTextFileSchema, ...errors },
      },
    },
    async (request, reply) => {
      try {
        const root = await resolveRoot(request.params.projectId, request.query.rootPath);
        reply.header("cache-control", "no-store");
        return await readProjectTextFile(root.path, request.query.path);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
  app.post<{
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
    Body: SaveProjectTextFileRequest;
  }>(
    "/v1/projects/:projectId/files/text",
    {
      // JSON 控制字符转义可膨胀到六倍；解码后仍严格检查 UTF-8 字节上限。
      bodyLimit: MAX_TEXT_FILE_BYTES * 6 + 8192,
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        body: SaveProjectTextFileRequestSchema,
        response: { 200: SaveProjectTextFileResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      try {
        const root = await resolveRoot(request.params.projectId, request.query.rootPath);
        return await saveProjectTextFile(root.path, request.body);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
