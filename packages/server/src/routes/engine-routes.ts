import { Type } from "@sinclair/typebox";
import {
  AgentEngineSchema,
  AgentEngineProfileSchema,
  ClaudeSettingsSchema,
  AgentProviderConnectionMutationResponseSchema,
  ConfigureCustomProviderRequestSchema,
  ConfigureCustomProviderResponseSchema,
  type AgentEngine,
  type ClaudeSettings,
  type ConfigureCustomProviderRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

const Params = Type.Object({ engine: AgentEngineSchema }, { additionalProperties: false });

export const registerEngineRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const service = (engine: AgentEngine) => {
    const value = context.provider.engines?.[engine];
    if (!value) throw new MutationHttpError("PROVIDER_ERROR", "Engine is unavailable", 503);
    return value;
  };
  app.get<{ Params: { engine: AgentEngine } }>(
    "/v1/engines/:engine/settings",
    { schema: { params: Params, response: { 200: ClaudeSettingsSchema } } },
    (request) => service(request.params.engine).readSettings(),
  );
  app.put<{
    Params: { engine: AgentEngine };
    Body: ClaudeSettings;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/engines/:engine/settings",
    {
      schema: {
        params: Params,
        headers: IdempotencyHeadersSchema,
        body: ClaudeSettingsSchema,
        response: { 200: ClaudeSettingsSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["engine-settings", request.params.engine],
        request.headers["idempotency-key"],
        request.body,
        () => service(request.params.engine).writeSettings(request.body),
      ),
  );
  app.get<{ Params: { engine: AgentEngine }; Querystring: { projectId?: string } }>(
    "/v1/engines/:engine",
    {
      schema: {
        params: Params,
        querystring: Type.Object(
          { projectId: Type.Optional(Type.String({ minLength: 1 })) },
          { additionalProperties: false },
        ),
        response: { 200: AgentEngineProfileSchema },
      },
    },
    async (request) => {
      const scope = request.query.projectId
        ? (await context.getProjectContext(request.query.projectId))?.scope
        : undefined;
      if (request.query.projectId && !scope)
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      if (request.params.engine === "codex")
        return {
          engine: "codex",
          capabilities: context.capabilities,
          models: await context.modelCatalogCache.read(),
          commands: [],
          connection: await context.provider.readProviderConnection(),
        };
      return service(request.params.engine).inspect(scope);
    },
  );
  app.put<{
    Params: { engine: AgentEngine };
    Headers: { "idempotency-key": string };
    Body: ConfigureCustomProviderRequest;
  }>(
    "/v1/engines/:engine/connection",
    {
      schema: {
        params: Params,
        headers: IdempotencyHeadersSchema,
        body: ConfigureCustomProviderRequestSchema,
        response: { 200: ConfigureCustomProviderResponseSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["configure-engine", request.params.engine],
        request.headers["idempotency-key"],
        request.body,
        () => service(request.params.engine).configure(request.body),
      ),
  );
  app.delete<{ Params: { engine: AgentEngine }; Headers: { "idempotency-key": string } }>(
    "/v1/engines/:engine/connection",
    {
      schema: {
        params: Params,
        headers: IdempotencyHeadersSchema,
        response: { 200: AgentProviderConnectionMutationResponseSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["disconnect-engine", request.params.engine],
        request.headers["idempotency-key"],
        {},
        () => service(request.params.engine).disconnect(),
      ),
  );
  done();
};
