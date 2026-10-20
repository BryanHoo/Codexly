import {
  AgentMutationErrorSchema,
  ConfiguredMcpServerPageSchema,
  InstalledSkillPageSchema,
  OpenSkillDirectoryResponseSchema,
  OfficialPluginDetailSchema,
  OfficialPluginInstallResponseSchema,
  OfficialPluginPageSchema,
  PluginReconcileResultSchema,
  OfficialPluginUninstallResponseSchema,
  SetMcpServerEnabledResponseSchema,
  SetSkillEnabledResponseSchema,
} from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginCallback } from "fastify";

import { SkillDirectoryError } from "../skill-market-service.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

const SkillPathBodySchema = Type.Object(
  { path: Type.String({ maxLength: 4_096, minLength: 1 }) },
  { additionalProperties: false },
);
const SkillToggleBodySchema = Type.Object(
  { enabled: Type.Boolean(), path: Type.String({ maxLength: 4_096, minLength: 1 }) },
  { additionalProperties: false },
);
const McpToggleBodySchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);
const OfficialPluginParamsSchema = Type.Object(
  {
    marketplaceName: Type.String({ maxLength: 160, minLength: 1 }),
    pluginName: Type.String({ maxLength: 240, minLength: 1 }),
  },
  { additionalProperties: false },
);
const OfficialPluginQuerySchema = Type.Object(
  { marketplacePath: Type.Optional(Type.String({ maxLength: 4_096, minLength: 1 })) },
  { additionalProperties: false },
);
const OfficialPluginListQuerySchema = Type.Object(
  { forceRefetch: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
const OfficialPluginInstallBodySchema = Type.Object(
  {
    installAttemptId: Type.String({ maxLength: 200, minLength: 1 }),
    marketplacePath: Type.Union([Type.String({ maxLength: 4_096, minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
const OfficialPluginUninstallBodySchema = Type.Object(
  { pluginId: Type.String({ maxLength: 300, minLength: 1 }) },
  { additionalProperties: false },
);

function toHttpError(error: unknown): never {
  if (!(error instanceof SkillDirectoryError)) throw error;
  throw new MutationHttpError("SKILL_DIRECTORY_UNAVAILABLE", error.message, 500);
}

const mutationErrors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  429: AgentMutationErrorSchema,
  500: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
};

export const registerSkillMarketRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { runIdempotent, skillMarketService } = context;

  app.post<{ Body: Record<string, never>; Headers: { "idempotency-key": string } }>(
    "/v1/plugins/official/reconcile",
    {
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        headers: IdempotencyHeadersSchema,
        response: { 200: PluginReconcileResultSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(
        ["reconcile-official-plugins"],
        request.headers["idempotency-key"],
        request.body,
        () => skillMarketService.reconcileOfficialPlugins(),
      ),
  );
  app.get("/v1/skills/installed", { schema: { response: { 200: InstalledSkillPageSchema } } }, () =>
    skillMarketService.listInstalledSkills(false),
  );
  app.get<{ Querystring: { forceRefetch?: boolean } }>(
    "/v1/plugins/official",
    {
      schema: {
        querystring: OfficialPluginListQuerySchema,
        response: { 200: OfficialPluginPageSchema },
      },
    },
    (request) => skillMarketService.listOfficialPlugins(request.query.forceRefetch ?? false),
  );
  app.get<{
    Params: { marketplaceName: string; pluginName: string };
    Querystring: { marketplacePath?: string };
  }>(
    "/v1/plugins/official/:marketplaceName/:pluginName",
    {
      schema: {
        params: OfficialPluginParamsSchema,
        querystring: OfficialPluginQuerySchema,
        response: { 200: OfficialPluginDetailSchema, ...mutationErrors },
      },
    },
    (request) =>
      skillMarketService.getOfficialPlugin(
        request.params.marketplaceName,
        request.query.marketplacePath ?? null,
        request.params.pluginName,
      ),
  );
  app.post<{
    Body: { installAttemptId: string; marketplacePath: string | null };
    Headers: { "idempotency-key": string };
    Params: { marketplaceName: string; pluginName: string };
  }>(
    "/v1/plugins/official/:marketplaceName/:pluginName/install",
    {
      schema: {
        body: OfficialPluginInstallBodySchema,
        headers: IdempotencyHeadersSchema,
        params: OfficialPluginParamsSchema,
        response: { 200: OfficialPluginInstallResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(
        ["install-official-plugin", request.params.marketplaceName, request.params.pluginName],
        request.headers["idempotency-key"],
        request.body,
        async () => ({
          ...(await skillMarketService.installOfficialPlugin(
            request.params.marketplaceName,
            request.body.marketplacePath,
            request.params.pluginName,
            request.body.installAttemptId,
          )),
          plugins: await skillMarketService.listOfficialPlugins(true),
        }),
      ),
  );
  app.post<{
    Body: { pluginId: string };
    Headers: { "idempotency-key": string };
    Params: { marketplaceName: string; pluginName: string };
  }>(
    "/v1/plugins/official/:marketplaceName/:pluginName/uninstall",
    {
      schema: {
        body: OfficialPluginUninstallBodySchema,
        headers: IdempotencyHeadersSchema,
        params: OfficialPluginParamsSchema,
        response: { 200: OfficialPluginUninstallResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(
        ["uninstall-official-plugin", request.params.marketplaceName, request.params.pluginName],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          await skillMarketService.uninstallOfficialPlugin(request.body.pluginId);
          return { plugins: await skillMarketService.listOfficialPlugins(true) };
        },
      ),
  );
  app.get<{ Querystring: { projectId?: string } }>(
    "/v1/mcp-servers/configured",
    {
      schema: {
        querystring: Type.Object(
          { projectId: Type.Optional(Type.String({ minLength: 1 })) },
          { additionalProperties: false },
        ),
        response: { 200: ConfiguredMcpServerPageSchema, ...mutationErrors },
      },
    },
    async (request) => {
      if (!request.query.projectId) return skillMarketService.listConfiguredMcpServers();
      // 只接受已登记的项目 ID，不接受浏览器提供的任意磁盘路径。
      const project = await context.projectRepository.read(request.query.projectId);
      const root = project?.roots[0]?.path;
      if (!root) throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      return skillMarketService.listConfiguredMcpServers(root);
    },
  );
  app.post<{
    Body: { path: string };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/skills/open",
    {
      schema: {
        body: SkillPathBodySchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: OpenSkillDirectoryResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(["open-skill"], request.headers["idempotency-key"], request.body, () =>
        skillMarketService.openSkillDirectory(request.body.path).catch(toHttpError),
      ),
  );
  app.put<{
    Body: { enabled: boolean; path: string };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/skills/enabled",
    {
      schema: {
        body: SkillToggleBodySchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: SetSkillEnabledResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(
        ["set-skill-enabled", request.body.path],
        request.headers["idempotency-key"],
        request.body,
        async () => ({
          ...(await skillMarketService
            .setSkillEnabled(request.body.path, request.body.enabled)
            .catch(toHttpError)),
          // Provider 完成写入后强制刷新发现结果，随幂等响应返回权威目录。
          installedSkills: await skillMarketService.listInstalledSkills(true),
        }),
      ),
  );
  app.put<{
    Body: { enabled: boolean };
    Headers: { "idempotency-key": string };
    Params: { name: string };
  }>(
    "/v1/mcp-servers/configured/:name/enabled",
    {
      schema: {
        body: McpToggleBodySchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: SetMcpServerEnabledResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(
        ["set-mcp-enabled", request.params.name],
        request.headers["idempotency-key"],
        request.body,
        async () => ({
          ...(await skillMarketService
            .setMcpServerEnabled(request.params.name, request.body.enabled)
            .catch(toHttpError)),
          servers: await skillMarketService.listConfiguredMcpServers(),
        }),
      ),
  );
  done();
};
