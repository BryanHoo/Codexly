import {
  DiscardProjectChangesRequestSchema,
  ProjectGitStatusSchema,
  AgentMutationErrorSchema,
  type DiscardProjectChangesRequest,
  type ProjectRootQuery,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { discardSelectedProjectChanges } from "../git-discard.js";
import { GitCommitError } from "../git-commit.js";
import { originalErrorMessage } from "../error-message.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";
import { ProjectRootQuerySchema } from "@codexly/protocol";
import { resolveGitMutationRoot } from "./project-git-route-scope.js";

export function registerProjectGitDiscardRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
  assertGitMutationAvailable: (scope: string) => void,
): void {
  const { projectRepository, runIdempotent, activeGitMutations, toGitCommitHttpError } = context;
  app.post<{
    Body: DiscardProjectChangesRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/git/discard",
    {
      schema: {
        body: DiscardProjectChangesRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: {
          200: ProjectGitStatusSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const root = await resolveGitMutationRoot(
        projectRepository,
        request.params.projectId,
        request.query.rootPath,
      );
      const scope = `${request.params.projectId}\0${root}`;
      return runIdempotent(
        ["discard-project-changes", scope],
        request.headers["idempotency-key"],
        { request: request.body, rootPath: root },
        async () => {
          assertGitMutationAvailable(scope);
          activeGitMutations.add(scope);
          try {
            return await discardSelectedProjectChanges(root, request.body);
          } catch (error) {
            if (error instanceof GitCommitError) throw toGitCommitHttpError(error);
            throw new MutationHttpError(
              "GIT_COMMIT_FAILED",
              originalErrorMessage(error, "Git discard failed"),
              502,
            );
          } finally {
            activeGitMutations.delete(scope);
          }
        },
      );
    },
  );
}
