import {
  AgentMutationErrorSchema,
  DeleteProjectFileRequestSchema,
  DeleteProjectFileResponseSchema,
  ProjectRootQuerySchema,
  RenameProjectFileRequestSchema,
  RenameProjectFileResponseSchema,
  type DeleteProjectFileRequest,
  type ProjectRootQuery,
  type RenameProjectFileRequest,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { posix } from "node:path";

import { ProjectRootScopeError } from "../project-root-scope.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

type ResolveProjectFileRoot = (
  projectId: string,
  rootPath: string | undefined,
) => Promise<Readonly<{ id: string; path: string }>>;

function mapProjectFileMutationError(error: unknown): never {
  if (error instanceof ProjectRootScopeError) {
    throw new MutationHttpError(
      error.code === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : "INVALID_REQUEST",
      error.message,
      error.code === "PROJECT_NOT_FOUND" ? 404 : 400,
    );
  }
  const errorCode = (error as NodeJS.ErrnoException).code;
  if (errorCode === "ENOENT") {
    throw new MutationHttpError("PROJECT_FILE_NOT_FOUND", "Project file was not found", 404);
  }
  if (error instanceof TypeError) {
    const conflict = error.message.includes("already exists");
    throw new MutationHttpError(
      conflict ? "PROJECT_FILE_CONFLICT" : "INVALID_REQUEST",
      conflict
        ? "A file or directory with that name already exists"
        : "Project file request is invalid",
      conflict ? 409 : 400,
    );
  }
  throw new MutationHttpError("PROJECT_FILE_MUTATION_FAILED", "Project file mutation failed", 500);
}

const mutationResponses = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  500: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

function getParentDirectory(path: string): string | undefined {
  const parent = posix.dirname(path);
  return parent === "." ? undefined : parent;
}

export function registerProjectFileMutationRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
  resolveProjectFileRoot: ResolveProjectFileRoot,
): void {
  const { deleteProjectFile, readFileTree, renameProjectFile, runIdempotent } = context;

  app.post<{
    Body: RenameProjectFileRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/files/rename",
    {
      schema: {
        body: RenameProjectFileRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: { 200: RenameProjectFileResponseSchema, ...mutationResponses },
      },
    },
    async (request) =>
      runIdempotent(
        [
          "rename-project-file",
          request.params.projectId,
          request.query.rootPath,
          request.body.path,
        ],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            const root = await resolveProjectFileRoot(
              request.params.projectId,
              request.query.rootPath,
            );
            const result = await renameProjectFile(root.path, request.body.path, request.body.name);
            // 写操作响应携带父目录权威状态，前端无需再发起一次目录查询。
            const tree = await readFileTree(root.path, getParentDirectory(request.body.path));
            return { ...result, tree };
          } catch (error) {
            mapProjectFileMutationError(error);
          }
        },
      ),
  );

  app.post<{
    Body: DeleteProjectFileRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/files/delete",
    {
      schema: {
        body: DeleteProjectFileRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: { 200: DeleteProjectFileResponseSchema, ...mutationResponses },
      },
    },
    async (request) =>
      runIdempotent(
        [
          "delete-project-file",
          request.params.projectId,
          request.query.rootPath,
          request.body.path,
        ],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            const root = await resolveProjectFileRoot(
              request.params.projectId,
              request.query.rootPath,
            );
            const result = await deleteProjectFile(root.path, request.body.path);
            // 删除后重新读取目录，确保响应反映磁盘上的最终状态。
            const tree = await readFileTree(root.path, getParentDirectory(request.body.path));
            return { ...result, tree };
          } catch (error) {
            mapProjectFileMutationError(error);
          }
        },
      ),
  );
}
