import {
  PushProjectCommitsRequestSchema,
  PushProjectCommitsResponseSchema,
  AgentMutationErrorSchema,
  ProjectRootQuerySchema,
  type PushProjectCommitsRequest,
  type ProjectRootQuery,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { GitCommitError } from "../git-commit.js";
import { originalErrorMessage } from "../error-message.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";
import { resolveGitMutationRoot } from "./project-git-route-scope.js";

export function registerProjectGitPushRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
  assertGitMutationAvailable: (scope: string) => void,
): void {
  const {
    projectRepository,
    runIdempotent,
    activeGitMutations,
    pushProjectCommits,
    toGitCommitHttpError,
  } = context;
  app.post<{
    Body: PushProjectCommitsRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/git/push",
    {
      schema: {
        body: PushProjectCommitsRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: {
          200: PushProjectCommitsResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const rootPath = await resolveGitMutationRoot(
        projectRepository,
        request.params.projectId,
        request.query.rootPath,
      );
      const mutationScope = `${request.params.projectId}\0${rootPath}`;
      return runIdempotent(
        ["push-project-commits", mutationScope],
        request.headers["idempotency-key"],
        { request: request.body, rootPath },
        async () => {
          // inspect 只读取本地引用，不占用写锁；提交后的多次刷新可以安全重叠。
          // 真正修改仓库的操作仍与提交、切分支共用写锁，防止重复推送和并发写入。
          const writesRepository = request.body.action !== "inspect";
          if (writesRepository) {
            assertGitMutationAvailable(mutationScope);
            activeGitMutations.add(mutationScope);
          }
          try {
            return await pushProjectCommits(rootPath, request.body);
          } catch (error) {
            if (error instanceof GitCommitError) throw toGitCommitHttpError(error);
            throw new MutationHttpError(
              "GIT_PUSH_FAILED",
              originalErrorMessage(error, "Git push failed"),
              502,
            );
          } finally {
            // 只释放本次获取的写锁，避免只读请求完成时误删其他写操作的锁。
            if (writesRepository) activeGitMutations.delete(mutationScope);
          }
        },
      );
    },
  );
}
