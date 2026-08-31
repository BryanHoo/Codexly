import {
  AgentCapabilitiesSchema,
  AgentGlobalSettingsResponseSchema,
  AgentGlobalSettingsSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  AppInfoResponseSchema,
  AppUpdateProgressResponseSchema,
  EventStreamMetricsResponseSchema,
  HealthResponseSchema,
  InstallAppUpdateRequestSchema,
  InstallAppUpdateResponseSchema,
  type AgentGlobalSettings,
  type InstallAppUpdateRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";

import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";
import { createBingWallpaperService } from "../bing-wallpaper.js";

const APP_UPDATE_HANDLER_TIMEOUT_MS = 150_000;
const BingWallpaperQuerySchema = {
  additionalProperties: false,
  properties: { day: { pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: "string" } },
  required: ["day"],
  type: "object",
} as const;

export const registerRuntimeRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const bingWallpaper = createBingWallpaperService();
  const {
    assertValidProjectDefaults,
    capabilities,
    installAppUpdate,
    listModels,
    modelCatalogCache,
    projectContexts,
    readAppInfo,
    readAppUpdateProgress,
    readEffectiveGlobalSettings,
    runIdempotent,
    settingsRepository,
  } = context;

  app.get("/v1/health", { schema: { response: { 200: HealthResponseSchema } } }, () => ({
    status: "ok" as const,
    version: 1 as const,
  }));

  app.get("/v1/app-info", { schema: { response: { 200: AppInfoResponseSchema } } }, () =>
    readAppInfo(),
  );

  app.get(
    "/v1/app-update/progress",
    { schema: { response: { 200: AppUpdateProgressResponseSchema } } },
    () => readAppUpdateProgress(),
  );

  app.get<{ Querystring: { day: string } }>(
    "/v1/workbench-background/bing",
    { schema: { querystring: BingWallpaperQuerySchema } },
    async (request, reply) => {
      const wallpaper = await bingWallpaper.read(request.query.day);
      return reply.type(wallpaper.contentType).send(wallpaper.body);
    },
  );

  app.post<{
    Body: InstallAppUpdateRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/app-update",
    {
      handlerTimeout: APP_UPDATE_HANDLER_TIMEOUT_MS,
      schema: {
        body: InstallAppUpdateRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: InstallAppUpdateResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["install-app-update"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return await installAppUpdate(request.body.version);
          } catch (error) {
            const code =
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              (error.code === "UPDATE_NOT_AVAILABLE" ||
                error.code === "UPDATE_CHECK_FAILED" ||
                error.code === "UPDATE_INSTALL_FAILED")
                ? error.code
                : "UPDATE_INSTALL_FAILED";
            throw new MutationHttpError(
              code,
              error instanceof Error ? error.message : "Failed to install the Codexly update",
              code === "UPDATE_NOT_AVAILABLE" ? 409 : 502,
              code !== "UPDATE_NOT_AVAILABLE",
            );
          }
        },
      ),
  );

  app.get(
    "/v1/metrics/events",
    { schema: { response: { 200: EventStreamMetricsResponseSchema } } },
    () => ({
      projects: [...projectContexts.values()].map((context) => ({
        ...context.eventStream.metrics,
        activeClients: context.transportMetrics.activeClients,
        projectId: context.scope.id,
        slowClientDisconnects: context.transportMetrics.slowClientDisconnects,
      })),
      version: 1 as const,
    }),
  );

  app.get(
    "/v1/capabilities",
    { schema: { response: { 200: AgentCapabilitiesSchema } } },
    () => capabilities,
  );

  app.get("/v1/models", { schema: { response: { 200: AgentModelPageSchema } } }, () =>
    modelCatalogCache.read(),
  );

  app.get(
    "/v1/settings",
    { schema: { response: { 200: AgentGlobalSettingsResponseSchema } } },
    async () => ({ settings: await readEffectiveGlobalSettings() }),
  );

  app.put<{
    Body: AgentGlobalSettings;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/settings",
    {
      schema: {
        body: AgentGlobalSettingsSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: AgentGlobalSettingsResponseSchema,
          400: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["update-global-settings"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await settingsRepository.writeGlobalSettings(request.body),
          };
        },
      ),
  );
  done();
};
