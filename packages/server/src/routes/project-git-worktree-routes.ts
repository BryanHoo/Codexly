import {
  AgentMutationErrorSchema,
  CreateProjectWorktreeRequestSchema,
  ProjectGitWorktreePageSchema,
  ProjectRootQuerySchema,
  ProjectWorktreeMutationResponseSchema,
  SwitchProjectWorktreeRequestSchema,
  type CreateProjectWorktreeRequest,
  type ProjectRootQuery,
  type SwitchProjectWorktreeRequest,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";
import { basename } from "node:path";

import { originalErrorMessage } from "../error-message.js";
import { GitWorktreeError } from "../git-worktree.js";
import { ProjectRootScopeError, resolveProjectRoot } from "../project-root-scope.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

function toGitWorktreeHttpError(error: GitWorktreeError): MutationHttpError {
  switch (error.code) {
    case "SNAPSHOT_MISMATCH":
      return new MutationHttpError("GIT_STATUS_CHANGED", "Git working tree changed", 409, true);
    case "ALREADY_ACTIVE":
      return new MutationHttpError("GIT_WORKTREE_ALREADY_ACTIVE", error.message, 409, true);
    case "WORKTREE_NOT_FOUND":
      return new MutationHttpError("GIT_WORKTREE_NOT_FOUND", error.message, 409, true);
    case "INVALID_BRANCH_NAME":
      return new MutationHttpError("GIT_BRANCH_INVALID", error.message, 400, false);
    case "REPOSITORY_READ_ONLY":
      return new MutationHttpError("GIT_REPOSITORY_READ_ONLY", error.message, 409, true);
    case "CREATE_FAILED":
      return new MutationHttpError("GIT_WORKTREE_CREATE_FAILED", error.message, 502, true);
  }
}

export function registerProjectGitWorktreeRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
): void {
  const {
    activeGitMutations,
    createProjectWorktree,
    projectRepository,
    readProjectWorktrees,
    resolveProjectWorktree,
    runIdempotent,
  } = context;
  const assertGitMutationAvailable = (mutationScope: string) => {
    if (activeGitMutations.has(mutationScope)) {
      throw new MutationHttpError(
        "GIT_MUTATION_IN_PROGRESS",
        "Another Git mutation is already in progress",
        409,
        true,
      );
    }
  };
  const resolveMutationRoot = async (projectId: string, rootPath: string): Promise<string> => {
    try {
      return await resolveProjectRoot(projectRepository, projectId, rootPath);
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
  };

  app.get<{ Params: { projectId: string }; Querystring: ProjectRootQuery }>(
    "/v1/projects/:projectId/git/worktrees",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: {
          200: ProjectGitWorktreePageSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const rootPath = await resolveProjectRoot(
          projectRepository,
          request.params.projectId,
          request.query.rootPath,
        );
        return await readProjectWorktrees(rootPath);
      } catch (error) {
        if (error instanceof ProjectRootScopeError) {
          const status = error.code === "PROJECT_NOT_FOUND" ? 404 : 400;
          return reply.code(status).send({ code: error.code, message: error.message });
        }
        return reply.code(500).send({
          code: "GIT_WORKTREE_LIST_FAILED",
          message: originalErrorMessage(error, "Git worktree list failed"),
        });
      }
    },
  );

  app.post<{
    Body: CreateProjectWorktreeRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/git/worktrees",
    {
      schema: {
        body: CreateProjectWorktreeRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: {
          200: ProjectWorktreeMutationResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const rootPath = await resolveMutationRoot(request.params.projectId, request.query.rootPath);
      const mutationScope = `${request.params.projectId}\0${rootPath}`;
      return runIdempotent(
        ["create-project-worktree", mutationScope],
        request.headers["idempotency-key"],
        { request: request.body, rootPath },
        async () => {
          assertGitMutationAvailable(mutationScope);
          activeGitMutations.add(mutationScope);
          try {
            const worktree = await createProjectWorktree(rootPath, request.body);
            // 每个 worktree 形成独立 Project，避免当前 Task Runtime 被静默换目录。
            const project = await projectRepository.register({
              idempotencyKey: request.headers["idempotency-key"],
              name: basename(worktree.path),
              roots: [{ path: worktree.path }],
            });
            return { project, worktree };
          } catch (error) {
            if (error instanceof GitWorktreeError) throw toGitWorktreeHttpError(error);
            throw new MutationHttpError(
              "GIT_WORKTREE_CREATE_FAILED",
              originalErrorMessage(error, "Git worktree creation failed"),
              502,
              true,
            );
          } finally {
            activeGitMutations.delete(mutationScope);
          }
        },
      );
    },
  );

  app.post<{
    Body: SwitchProjectWorktreeRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/git/worktree",
    {
      schema: {
        body: SwitchProjectWorktreeRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: {
          200: ProjectWorktreeMutationResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const rootPath = await resolveMutationRoot(request.params.projectId, request.query.rootPath);
      return runIdempotent(
        ["switch-project-worktree", request.params.projectId, rootPath],
        request.headers["idempotency-key"],
        { request: request.body, rootPath },
        async () => {
          try {
            const worktree = await resolveProjectWorktree(rootPath, request.body.path);
            const project = await projectRepository.register({
              idempotencyKey: request.headers["idempotency-key"],
              name: basename(worktree.path),
              roots: [{ path: worktree.path }],
            });
            return { project, worktree };
          } catch (error) {
            if (error instanceof GitWorktreeError) throw toGitWorktreeHttpError(error);
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              originalErrorMessage(error, "Git worktree switch failed"),
              502,
              true,
            );
          }
        },
      );
    },
  );
}
