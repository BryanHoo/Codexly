import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AcpConfigPreviewSchema,
  AcpConfigPreviewRequestSchema,
  type AcpConfigPreviewRequest,
  AgentEngineSchema,
  AcpAgentProfileSchema,
  AcpAuthenticateRequestSchema,
  AcpAuthenticateResponseSchema,
  AcpDefaultsSchema,
  AcpDefaultsRequestSchema,
  AcpSessionConfigSchema,
  AcpSessionStateSchema,
  AcpSessionConfigRequestSchema,
  AcpProviderConfigSchema,
  AcpProviderPageSchema,
  type AcpProviderConfig,
  type AcpAuthCredentials,
  type AgentEngine,
  type AcpConfigValues,
} from "@codexly/protocol";
import type { AcpAgentServices } from "@codexly/core";
import type { FastifyPluginCallback, FastifySchema, FastifySchemaCompiler } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { resolveProjectRoot, ProjectRootScopeError } from "../project-root-scope.js";

const Params = Type.Object({ engine: AgentEngineSchema }, { additionalProperties: false });
const IdempotencyHeadersSchema = Type.Object({ "idempotency-key": Type.String({ minLength: 1 }) });
// ACP 配置值有 string/boolean 两种，禁止 AJV 的自动类型转换和静默删字段。
const validatorCompiler: FastifySchemaCompiler<FastifySchema> =
  ({ schema }) =>
  (value) =>
    Value.Check(schema as TSchema, value) ? { value } : { error: new Error("Invalid ACP request") };

export const registerAcpRoutes: FastifyPluginCallback<{
  context: ServerRouteContext;
  agents: AcpAgentServices | undefined;
}> = (app, { context, agents }, done) => {
  const service = (engine: AgentEngine) => {
    if (!agents) throw new MutationHttpError("PROVIDER_ERROR", "ACP service is unavailable", 503);
    return agents[engine];
  };
  const providers = (engine: AgentEngine) => {
    const value = service(engine).providers;
    if (!value) throw new MutationHttpError("PROVIDER_ERROR", "ACP providers are unavailable", 503);
    return value;
  };
  app.get<{ Params: { engine: AgentEngine } }>(
    "/v1/acp/agents/:engine/providers",
    {
      validatorCompiler,
      schema: { params: Params, response: { 200: AcpProviderPageSchema } },
    },
    (request) => providers(request.params.engine).list(),
  );
  app.put<{
    Params: { engine: AgentEngine };
    Body: AcpProviderConfig;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/agents/:engine/providers",
    {
      validatorCompiler,
      schema: {
        params: Params,
        body: AcpProviderConfigSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AcpProviderPageSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["acp-provider", request.params.engine],
        request.headers["idempotency-key"],
        request.body,
        () => providers(request.params.engine).configure(request.body),
      ),
  );
  app.delete<{
    Params: { engine: AgentEngine; providerId: string };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/agents/:engine/providers/:providerId",
    {
      validatorCompiler,
      schema: {
        params: Type.Object(
          { engine: AgentEngineSchema, providerId: Type.String({ minLength: 1, maxLength: 256 }) },
          { additionalProperties: false },
        ),
        headers: IdempotencyHeadersSchema,
        response: { 200: AcpProviderPageSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["acp-provider-disable", request.params.engine, request.params.providerId],
        request.headers["idempotency-key"],
        {},
        () => providers(request.params.engine).disable(request.params.providerId),
      ),
  );
  app.post<{ Params: { projectId: string; engine: AgentEngine }; Body: AcpConfigPreviewRequest }>(
    "/v1/projects/:projectId/acp/:engine/preview",
    {
      validatorCompiler,
      schema: {
        params: Type.Object(
          { projectId: Type.String({ minLength: 1 }), engine: AgentEngineSchema },
          { additionalProperties: false },
        ),
        body: AcpConfigPreviewRequestSchema,
        response: { 200: AcpConfigPreviewSchema },
      },
    },
    async (request) => {
      const project = await context.getProjectContext(request.params.projectId);
      if (!project) throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      const agent = service(request.params.engine);
      if (!agent.previewConfig)
        throw new MutationHttpError("PROVIDER_ERROR", "ACP preview unavailable", 503);
      let cwd = project.scope.rootPath;
      if (request.body.workspacePath !== undefined) {
        try {
          cwd = await resolveProjectRoot(
            context.projectRepository,
            request.params.projectId,
            request.body.workspacePath,
          );
        } catch (error) {
          if (error instanceof ProjectRootScopeError)
            throw new MutationHttpError("INVALID_REQUEST", "ACP preview workspace is invalid", 400);
          throw error;
        }
      }
      // 预览与首发共用根目录授权，不能把任意浏览器路径交给 agent。
      return agent.previewConfig(cwd, request.body, request.signal);
    },
  );
  const taskProvider = async (params: { projectId: string; taskId: string }) => {
    const project = await context.getProjectContext(params.projectId);
    if (!project) throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
    const task = await project.provider.readTaskMetadata?.(params.taskId);
    if (!task || task.projectId !== project.scope.id)
      throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
    return project.provider;
  };
  const TaskParams = Type.Object(
    { projectId: Type.String({ minLength: 1 }), taskId: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  );
  app.addHook("onRequest", (_request, reply, next) => {
    reply.header("cache-control", "no-store");
    next();
  });
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/acp/session",
    { validatorCompiler, schema: { params: TaskParams, response: { 200: AcpSessionStateSchema } } },
    async (request) => {
      const provider = await taskProvider(request.params);
      if (!provider.readSessionState)
        throw new MutationHttpError("PROVIDER_ERROR", "ACP session state is unavailable", 503);
      return provider.readSessionState(request.params.taskId);
    },
  );
  app.get<{ Params: { engine: AgentEngine } }>(
    "/v1/acp/agents/:engine",
    {
      validatorCompiler,
      schema: { params: Params, response: { 200: AcpAgentProfileSchema } },
    },
    (request) => service(request.params.engine).inspect(),
  );
  app.get<{ Params: { engine: AgentEngine } }>(
    "/v1/acp/agents/:engine/defaults",
    {
      validatorCompiler,
      schema: { params: Params, response: { 200: AcpDefaultsSchema } },
    },
    (request) => service(request.params.engine).readDefaults(),
  );
  app.put<{
    Params: { engine: AgentEngine };
    Body: { values: AcpConfigValues };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/agents/:engine/defaults",
    {
      validatorCompiler,
      schema: {
        params: Params,
        body: AcpDefaultsRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AcpDefaultsSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["acp-defaults", request.params.engine],
        request.headers["idempotency-key"],
        request.body,
        () => service(request.params.engine).updateDefaults(request.body.values),
      ),
  );
  app.patch<{
    Params: { engine: AgentEngine };
    Body: { configId: string; value: string | boolean };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/agents/:engine/defaults",
    {
      validatorCompiler,
      schema: {
        params: Params,
        body: AcpSessionConfigRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AcpDefaultsSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["acp-default-config", request.params.engine],
        request.headers["idempotency-key"],
        request.body,
        () =>
          service(request.params.engine).setDefaultConfig(
            request.body.configId,
            request.body.value,
          ),
      ),
  );
  app.post<{
    Params: { engine: AgentEngine };
    Body: { methodId: string; credentials?: AcpAuthCredentials };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/agents/:engine/authenticate",
    {
      handlerTimeout: 150_000,
      validatorCompiler,
      schema: {
        params: Params,
        body: AcpAuthenticateRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AcpAuthenticateResponseSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["acp-authenticate", request.params.engine],
        request.headers["idempotency-key"],
        request.body,
        () =>
          request.body.credentials
            ? service(request.params.engine).authenticate(
                request.body.methodId,
                request.signal,
                request.body.credentials,
              )
            : service(request.params.engine).authenticate(request.body.methodId, request.signal),
      ),
  );
  app.get<{ Params: { projectId: string; taskId: string } }>(
    "/v1/projects/:projectId/tasks/:taskId/acp/config",
    {
      validatorCompiler,
      schema: { params: TaskParams, response: { 200: AcpSessionConfigSchema } },
    },
    async (request) => {
      const provider = await taskProvider(request.params);
      if (!provider.readSessionConfiguration)
        throw new MutationHttpError(
          "PROVIDER_ERROR",
          "ACP session configuration is unavailable",
          503,
        );
      return provider.readSessionConfiguration(request.params.taskId);
    },
  );
  app.put<{
    Params: { projectId: string; taskId: string };
    Body: { configId: string; value: string | boolean };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects/:projectId/tasks/:taskId/acp/config",
    {
      validatorCompiler,
      schema: {
        params: TaskParams,
        body: AcpSessionConfigRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AcpSessionConfigSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["acp-session-config", request.params.projectId, request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const provider = await taskProvider(request.params);
          if (!provider.setSessionConfiguration)
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              "ACP session configuration is unavailable",
              503,
            );
          return provider.setSessionConfiguration(
            request.params.taskId,
            request.body.configId,
            request.body.value,
          );
        },
      ),
  );
  done();
};
