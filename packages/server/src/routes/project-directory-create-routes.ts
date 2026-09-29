import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentMutationErrorSchema,
  CreateProjectDirectoryRequestSchema,
  CreateProjectDirectoryResponseSchema,
  isValidProjectDirectoryName,
  type CreateProjectDirectoryRequest,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

export function registerProjectDirectoryCreateRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
) {
  app.post<{ Body: CreateProjectDirectoryRequest; Headers: { "idempotency-key": string } }>(
    "/v1/project-directories",
    {
      schema: {
        body: CreateProjectDirectoryRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: CreateProjectDirectoryResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      context.runIdempotent(
        ["create-project-directory"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (!isValidProjectDirectoryName(request.body.name)) {
            throw new MutationHttpError("INVALID_REQUEST", "Invalid folder name", 400);
          }
          try {
            // 复用目录浏览的真实路径与 workspaceRoots 校验，创建操作不能越过已配置的范围。
            const parent = await context.resolveProjectDirectory(request.body.parentPath);
            const path = join(parent, request.body.name);
            try {
              await mkdir(path);
              return { path, status: "created" as const };
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
              const metadata = await lstat(path);
              // 不把同名符号链接当作可直接复用的目录，避免跳转到用户未选择的位置。
              return {
                path,
                status: metadata.isDirectory()
                  ? ("exists-directory" as const)
                  : ("exists-file" as const),
              };
            }
          } catch {
            throw new MutationHttpError(
              "INVALID_REQUEST",
              "Folder could not be created; check the parent directory and permissions",
              400,
            );
          }
        },
      ),
  );
}
