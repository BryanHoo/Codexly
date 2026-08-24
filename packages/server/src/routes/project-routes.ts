import { basename } from "node:path";
import {
  AddProjectResponseSchema,
  AddProjectRequestSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentSkillPageSchema,
  AgentMutationErrorSchema,
  HostFileListingSchema,
  HostFileQuerySchema,
  ProjectPageSchema,
  ProjectDirectoryListingSchema,
  ProjectDirectoryQuerySchema,
  ProjectOpenCapabilitiesResponseSchema,
  ProjectRootQuerySchema,
  OpenProjectRequestSchema,
  OpenProjectResponseSchema,
  RenameProjectRequestSchema,
  RenameProjectResponseSchema,
  ReorderProjectsRequestSchema,
  ReorderProjectsResponseSchema,
  RemoveProjectRequestSchema,
  RemoveProjectResponseSchema,
  type AddProjectRequest,
  type AgentProjectDefaults,
  type HostFileQuery,
  type ProjectDirectoryQuery,
  type OpenProjectRequest,
  type ProjectRootQuery,
  type RenameProjectRequest,
  type ReorderProjectsRequest,
  type RemoveProjectRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { HostFileBrowserError } from "../host-file-browser.js";
import { ProjectOpenAppUnavailableError, ProjectOpenTargetInvalidError } from "../project-open.js";
import { ProjectDirectoryBrowserError } from "../project-directory-browser.js";
import { ProjectRootScopeError, resolveProjectRoot } from "../project-root-scope.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

import { registerProjectFileRoutes } from "./project-file-routes.js";
import { registerProjectGitRoutes } from "./project-git-routes.js";

export const registerProjectRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const {
    assertValidProjectDefaults,
    getProjectContext,
    listModels,
    projectOpenService,
    projectRepository,
    readEffectiveProjectDefaults,
    readHostFileDirectory,
    readProjectDirectory,
    releaseProjectContext,
    runIdempotent,
    resolveProjectDirectory,
    settingsRepository,
  } = context;

  app.get("/v1/projects", { schema: { response: { 200: ProjectPageSchema } } }, async () => ({
    data: await projectRepository.list(),
    nextCursor: null,
  }));

  app.get<{ Querystring: HostFileQuery }>(
    "/v1/host-files",
    {
      schema: {
        querystring: HostFileQuerySchema,
        response: { 200: HostFileListingSchema, 400: AgentMutationErrorSchema },
      },
    },
    async (request) => {
      try {
        return await readHostFileDirectory(request.query.kind, request.query.path, {
          ...(request.query.includeHidden === undefined
            ? {}
            : { includeHidden: request.query.includeHidden }),
        });
      } catch (error) {
        if (error instanceof HostFileBrowserError) {
          throw new MutationHttpError("INVALID_REQUEST", error.message, 400);
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: ProjectDirectoryQuery }>(
    "/v1/project-directories",
    {
      schema: {
        querystring: ProjectDirectoryQuerySchema,
        response: { 200: ProjectDirectoryListingSchema, 400: AgentMutationErrorSchema },
      },
    },
    async (request) => {
      try {
        return await readProjectDirectory(request.query.path, {
          ...(request.query.includeHidden === undefined
            ? {}
            : { includeHidden: request.query.includeHidden }),
        });
      } catch (error) {
        if (error instanceof ProjectDirectoryBrowserError) {
          throw new MutationHttpError("INVALID_REQUEST", error.message, 400);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/open-capabilities",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: ProjectOpenCapabilitiesResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const project = await projectRepository.read(request.params.projectId);
      if (project === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return projectOpenService.getCapabilities();
    },
  );

  app.post<{
    Body: OpenProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
    Querystring: ProjectRootQuery;
  }>(
    "/v1/projects/:projectId/open",
    {
      schema: {
        body: OpenProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        querystring: ProjectRootQuerySchema,
        response: {
          200: OpenProjectResponseSchema,
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
        ["open-project", request.params.projectId],
        request.headers["idempotency-key"],
        { request: request.body, rootPath: request.query.rootPath },
        async () => {
          let rootPath: string;
          try {
            rootPath = await resolveProjectRoot(
              projectRepository,
              request.params.projectId,
              request.query.rootPath,
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
            await projectOpenService.open(rootPath, request.body.appId, request.body.path);
          } catch (error) {
            if (error instanceof ProjectOpenAppUnavailableError) {
              throw new MutationHttpError(
                "INVALID_REQUEST",
                "Project open app is unavailable",
                409,
              );
            }
            if (error instanceof ProjectOpenTargetInvalidError) {
              throw new MutationHttpError("INVALID_REQUEST", "Project open target is invalid", 400);
            }
            throw new MutationHttpError("PROVIDER_ERROR", "Project could not be opened", 502, true);
          }
          return request.body;
        },
      ),
  );

  app.put<{
    Body: ReorderProjectsRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects/order",
    {
      schema: {
        body: ReorderProjectsRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: ReorderProjectsResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["reorder-projects"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const projects = await projectRepository.list();
          const storedProjectIds = new Set(projects.map((project) => project.id));
          const containsCompleteProjectSet =
            request.body.projectIds.length === projects.length &&
            request.body.projectIds.every((projectId) => storedProjectIds.has(projectId));
          if (!containsCompleteProjectSet) {
            throw new MutationHttpError(
              "INVALID_REQUEST",
              "Project order must contain every project exactly once",
              409,
            );
          }
          return {
            data: await projectRepository.reorder(request.body.projectIds),
            nextCursor: null,
          };
        },
      ),
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/skills",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentSkillPageSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return context.provider.listSkills();
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentProjectDefaultsResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      if ((await getProjectContext(request.params.projectId)) === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      return { settings: await readEffectiveProjectDefaults(request.params.projectId) };
    },
  );

  app.put<{
    Body: AgentProjectDefaults;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        body: AgentProjectDefaultsSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: AgentProjectDefaultsResponseSchema,
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
        ["update-project-defaults", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if ((await getProjectContext(request.params.projectId)) === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await settingsRepository.writeProjectDefaults(
              request.params.projectId,
              request.body,
            ),
          };
        },
      ),
  );

  app.post<{
    Body: AddProjectRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects",
    {
      schema: {
        body: AddProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: AddProjectResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(["add-project"], request.headers["idempotency-key"], request.body, async () => {
        let selectedPaths: string[];
        try {
          selectedPaths = await Promise.all(
            request.body.roots.map((root) => resolveProjectDirectory(root.path)),
          );
        } catch (error) {
          if (error instanceof ProjectDirectoryBrowserError) {
            throw new MutationHttpError("INVALID_REQUEST", error.message, 400);
          }
          throw error;
        }
        const project = await projectRepository.register({
          idempotencyKey: request.headers["idempotency-key"],
          name: basename(selectedPaths[0] ?? ""),
          roots: selectedPaths.map((path) => ({ path })),
        });
        return { project };
      }),
  );

  app.post<{
    Body: RenameProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/rename",
    {
      schema: {
        body: RenameProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: RenameProjectResponseSchema,
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
        ["rename-project", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const project = await projectRepository.rename(
            request.params.projectId,
            request.body.name.trim(),
          );
          if (project === undefined) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          return { project };
        },
      ),
  );

  app.post<{
    Body: RemoveProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/remove",
    {
      schema: {
        body: RemoveProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: RemoveProjectResponseSchema,
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
        ["remove-project", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (!(await projectRepository.remove(request.params.projectId))) {
            throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
          }
          await releaseProjectContext(request.params.projectId);
          return { projectId: request.params.projectId, status: "removed" as const };
        },
      ),
  );

  registerProjectGitRoutes(app, context);
  registerProjectFileRoutes(app, context);
  done();
};
