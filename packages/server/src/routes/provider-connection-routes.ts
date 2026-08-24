import {
  AgentMutationErrorSchema,
  AgentProviderConnectionMutationResponseSchema,
  AgentProviderConnectionStatusSchema,
  CancelProviderLoginRequestSchema,
  ConfigureCustomProviderRequestSchema,
  ConfigureCustomProviderResponseSchema,
  StartOfficialProviderLoginRequestSchema,
  StartOfficialProviderLoginResponseSchema,
  type CancelProviderLoginRequest,
  type ConfigureCustomProviderRequest,
  type StartOfficialProviderLoginRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import type { ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

const mutationResponses = {
  400: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

export const registerProviderConnectionRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { modelCatalogCache, provider, providerConnectionRepository, runIdempotent } = context;

  app.get(
    "/v1/provider-connection",
    { schema: { response: { 200: AgentProviderConnectionStatusSchema } } },
    () => provider.readProviderConnection(),
  );

  app.post<{
    Body: StartOfficialProviderLoginRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/provider-connection/official-login",
    {
      schema: {
        body: StartOfficialProviderLoginRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: StartOfficialProviderLoginResponseSchema, ...mutationResponses },
      },
    },
    (request) =>
      runIdempotent(
        ["start-official-provider-login"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const result = await provider.startOfficialProviderLogin();
          await providerConnectionRepository.writeProviderConnection({
            customBaseUrl: null,
            customModels: null,
            mode: "official",
            updatedAt: new Date().toISOString(),
          });
          modelCatalogCache.clear();
          return result;
        },
      ),
  );

  app.post<{
    Body: CancelProviderLoginRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/provider-connection/official-login/cancel",
    {
      schema: {
        body: CancelProviderLoginRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AgentProviderConnectionMutationResponseSchema, ...mutationResponses },
      },
    },
    (request) =>
      runIdempotent(
        ["cancel-provider-login", request.body.loginId],
        request.headers["idempotency-key"],
        request.body,
        () => provider.cancelProviderLogin(request.body.loginId),
      ),
  );

  app.put<{
    Body: ConfigureCustomProviderRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/provider-connection/custom",
    {
      schema: {
        body: ConfigureCustomProviderRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: ConfigureCustomProviderResponseSchema, ...mutationResponses },
      },
    },
    (request) =>
      runIdempotent(
        ["configure-custom-provider"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const result = await provider.configureCustomProvider(request.body);
          await providerConnectionRepository.writeProviderConnection({
            customBaseUrl: result.status.customBaseUrl,
            customModels: result.models,
            mode: "custom",
            updatedAt: new Date().toISOString(),
          });
          modelCatalogCache.clear();
          return result;
        },
      ),
  );

  app.post<{ Body: Record<string, never>; Headers: { "idempotency-key": string } }>(
    "/v1/provider-connection/logout",
    {
      schema: {
        body: StartOfficialProviderLoginRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AgentProviderConnectionMutationResponseSchema, ...mutationResponses },
      },
    },
    (request) =>
      runIdempotent(["logout-provider"], request.headers["idempotency-key"], request.body, () =>
        provider.logoutProvider(),
      ),
  );

  done();
};
