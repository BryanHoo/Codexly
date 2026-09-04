import {
  AgentMutationErrorSchema,
  ClawhubSkillDetailSchema,
  ClawhubSkillPageSchema,
  ConfiguredMcpServerPageSchema,
  InstalledSkillPageSchema,
  OpenSkillDirectoryResponseSchema,
  SetMcpServerEnabledResponseSchema,
  SetSkillEnabledResponseSchema,
  SkillInstallResultSchema,
  SkillInstallScopeSchema,
  type SkillInstallScope,
} from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginCallback } from "fastify";

import { SkillMarketError } from "../skill-market-error.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

const IdentityParamsSchema = Type.Object(
  {
    owner: Type.String({ maxLength: 100, minLength: 1, pattern: "^[A-Za-z0-9_-]+$" }),
    slug: Type.String({ maxLength: 100, minLength: 1, pattern: "^[A-Za-z0-9_-]+$" }),
  },
  { additionalProperties: false },
);
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
const InstallBodySchema = Type.Object(
  {
    projectId: Type.Optional(Type.String({ minLength: 1 })),
    rootPath: Type.Optional(Type.String({ minLength: 1 })),
    scope: SkillInstallScopeSchema,
  },
  { additionalProperties: false },
);
const MarketQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 2_048 })),
    query: Type.Optional(Type.String({ maxLength: 120 })),
    sort: Type.Optional(
      Type.Union([Type.Literal("recommended"), Type.Literal("downloads"), Type.Literal("updated")]),
    ),
  },
  { additionalProperties: false },
);

function toHttpError(error: unknown): never {
  if (!(error instanceof SkillMarketError)) throw error;
  const statusByCode = {
    SKILL_MARKET_CONFLICT: 409,
    SKILL_MARKET_FILESYSTEM: 500,
    SKILL_MARKET_INCOMPATIBLE: 409,
    SKILL_MARKET_INVALID_ARCHIVE: 409,
    SKILL_MARKET_INVALID_RESPONSE: 502,
    SKILL_MARKET_NETWORK: 502,
    SKILL_MARKET_NOT_FOUND: 404,
    SKILL_MARKET_RATE_LIMITED: 429,
    SKILL_MARKET_UNSAFE: 409,
  } as const;
  throw new MutationHttpError(
    error.code,
    error.message,
    statusByCode[error.code],
    error.code === "SKILL_MARKET_NETWORK" || error.code === "SKILL_MARKET_RATE_LIMITED",
  );
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

  app.get("/v1/skills/installed", { schema: { response: { 200: InstalledSkillPageSchema } } }, () =>
    skillMarketService.listInstalledSkills(false),
  );
  app.get<{ Querystring: { cursor?: string; query?: string; sort?: string } }>(
    "/v1/skills/market",
    { schema: { querystring: MarketQuerySchema, response: { 200: ClawhubSkillPageSchema } } },
    (request) =>
      skillMarketService
        .listSkills(
          request.query.query ?? "",
          request.query.cursor ?? null,
          request.query.sort ?? "recommended",
        )
        .catch(toHttpError),
  );
  app.get<{ Params: { owner: string; slug: string } }>(
    "/v1/skills/market/:owner/:slug",
    {
      schema: {
        params: IdentityParamsSchema,
        response: { 200: ClawhubSkillDetailSchema, ...mutationErrors },
      },
    },
    (request) =>
      skillMarketService.getSkill(request.params.owner, request.params.slug).catch(toHttpError),
  );
  app.get(
    "/v1/mcp-servers/configured",
    { schema: { response: { 200: ConfiguredMcpServerPageSchema } } },
    () => skillMarketService.listConfiguredMcpServers(),
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
        () =>
          skillMarketService
            .setSkillEnabled(request.body.path, request.body.enabled)
            .catch(toHttpError),
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
        () =>
          skillMarketService
            .setMcpServerEnabled(request.params.name, request.body.enabled)
            .catch(toHttpError),
      ),
  );
  app.post<{
    Body: { projectId?: string; rootPath?: string; scope: SkillInstallScope };
    Headers: { "idempotency-key": string };
    Params: { owner: string; slug: string };
  }>(
    "/v1/skills/market/:owner/:slug/install",
    {
      schema: {
        body: InstallBodySchema,
        headers: IdempotencyHeadersSchema,
        params: IdentityParamsSchema,
        response: { 200: SkillInstallResultSchema, ...mutationErrors },
      },
    },
    (request) =>
      runIdempotent(
        ["install-skill", request.params.owner, request.params.slug],
        request.headers["idempotency-key"],
        request.body,
        () =>
          skillMarketService
            .installSkill(request.params.owner, request.params.slug, request.body)
            .catch(toHttpError),
      ),
  );
  done();
};
