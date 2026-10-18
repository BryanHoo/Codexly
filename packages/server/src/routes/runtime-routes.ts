import { createGlobalSettingsWriter } from "../global-settings-writer.js";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Type } from "@sinclair/typebox";
import {
  AgentCapabilitiesSchema,
  BingWallpaperCatalogSchema,
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
import { createBingWallpaperCatalog } from "../bing-wallpaper-catalog.js";

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
  // 单服务实例一个低频原生采样器；关闭后停止，不能增加逐请求定时器。
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  app.addHook("onReady", (done) => {
    eventLoopDelay.enable();
    done();
  });
  app.addHook("onClose", (_instance, done) => {
    eventLoopDelay.disable();
    done();
  });
  const bingWallpaper = createBingWallpaperService();
  const bingCatalog = createBingWallpaperCatalog();
  app.get(
    "/v1/workbench-background/bing/catalog",
    { schema: { response: { 200: BingWallpaperCatalogSchema } } },
    () => bingCatalog.list(),
  );
  app.get<{ Querystring: { day: string; thumbnail?: boolean } }>(
    "/v1/workbench-background/bing/image",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["day"],
          properties: {
            day: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            thumbnail: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) =>
      reply
        .type("image/jpeg")
        .send(await bingCatalog.read(request.query.day, request.query.thumbnail ?? false)),
  );
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
  } = context;
  const writeGlobalSettings = createGlobalSettingsWriter(context);
  const writeApplicationSettings = createGlobalSettingsWriter(context, "claude");
  const settingsQuery = Type.Object(
    { engine: Type.Optional(Type.Union([Type.Literal("codex"), Type.Literal("claude")])) },
    { additionalProperties: false },
  );

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
      eventLoopDelayMs: {
        count: eventLoopDelay.count,
        p95: eventLoopDelay.count === 0 ? 0 : eventLoopDelay.percentile(95) / 1_000_000,
        p99: eventLoopDelay.count === 0 ? 0 : eventLoopDelay.percentile(99) / 1_000_000,
      },
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

  app.get<{ Querystring: { engine?: "codex" | "claude" } }>(
    "/v1/settings",
    {
      schema: { querystring: settingsQuery, response: { 200: AgentGlobalSettingsResponseSchema } },
    },
    async (request) => ({
      settings: await readEffectiveGlobalSettings(undefined, request.query.engine),
    }),
  );

  app.put<{
    Body: AgentGlobalSettings;
    Headers: { "idempotency-key": string };
    Querystring: { engine?: "codex" | "claude" };
  }>(
    "/v1/settings",
    {
      preValidation: (request, _reply, done) => {
        const value: unknown = (request.body as Record<string, unknown> | null)?.[
          "modelContextWindow"
        ];
        // 在 AJV 类型转换前拒绝字符串、布尔值等，避免它们被转换成 tokens 或 null。
        if (
          value !== undefined &&
          value !== null &&
          (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        ) {
          throw new MutationHttpError(
            "INVALID_REQUEST",
            "modelContextWindow must be a positive safe integer or null",
            400,
          );
        }
        done();
      },
      schema: {
        body: AgentGlobalSettingsSchema,
        querystring: settingsQuery,
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
        ["update-global-settings", request.query.engine ?? "codex"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (request.query.engine !== "claude")
            assertValidProjectDefaults(await listModels(), request.body);
          return {
            settings: await (
              request.query.engine === "claude" ? writeApplicationSettings : writeGlobalSettings
            )(request.body),
          };
        },
      ),
  );
  done();
};
