import {
  AgentMutationErrorSchema,
  AgentPreferencesSchema,
  GlobalInstructionsSchema,
  MemorySettingsSchema,
  MemorySettingsUpdateSchema,
  PersonalizationResetSchema,
  SaveGlobalInstructionsSchema,
  type AgentPreferences,
  type MemorySettingsUpdate,
  type SaveGlobalInstructions,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

export const registerPersonalizationRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const provider = () => {
    if (!context.provider.personalization)
      throw new MutationHttpError("PROVIDER_ERROR", "Personalization is unavailable", 503, true);
    return context.provider.personalization;
  };
  const errors = {
    409: AgentMutationErrorSchema,
    502: AgentMutationErrorSchema,
    503: AgentMutationErrorSchema,
  };
  const run = <T>(key: string, id: string, body: unknown, action: () => Promise<T>) =>
    context.runIdempotent([key], id, body, async () => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof MutationHttpError) throw error;
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "GLOBAL_INSTRUCTIONS_CHANGED"
        )
          throw new MutationHttpError("GLOBAL_INSTRUCTIONS_CHANGED", error.message, 409);
        throw new MutationHttpError(
          "PROVIDER_ERROR",
          error instanceof Error ? error.message : "Personalization request failed",
          502,
          true,
        );
      }
    });
  app.get(
    "/v1/personalization/instructions",
    { schema: { response: { 200: GlobalInstructionsSchema } } },
    () => provider().getGlobalInstructions(),
  );
  app.get(
    "/v1/personalization/memories",
    { schema: { response: { 200: MemorySettingsSchema } } },
    () => provider().getMemorySettings(),
  );
  app.get(
    "/v1/personalization/agent",
    { schema: { response: { 200: AgentPreferencesSchema } } },
    () => provider().getAgentPreferences(),
  );
  app.put<{ Body: SaveGlobalInstructions; Headers: { "idempotency-key": string } }>(
    "/v1/personalization/instructions",
    {
      schema: {
        body: SaveGlobalInstructionsSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: GlobalInstructionsSchema, ...errors },
      },
    },
    (request) =>
      run("save-global-instructions", request.headers["idempotency-key"], request.body, () =>
        provider().saveGlobalInstructions(request.body),
      ),
  );
  app.put<{ Body: MemorySettingsUpdate; Headers: { "idempotency-key": string } }>(
    "/v1/personalization/memories",
    {
      schema: {
        body: MemorySettingsUpdateSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: MemorySettingsSchema, ...errors },
      },
    },
    (request) =>
      run("update-memory-settings", request.headers["idempotency-key"], request.body, () =>
        provider().updateMemorySettings(request.body),
      ),
  );
  app.put<{ Body: AgentPreferences; Headers: { "idempotency-key": string } }>(
    "/v1/personalization/agent",
    {
      schema: {
        body: AgentPreferencesSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AgentPreferencesSchema, ...errors },
      },
    },
    (request) =>
      run("update-agent-preferences", request.headers["idempotency-key"], request.body, () =>
        provider().updateAgentPreferences(request.body),
      ),
  );
  app.post<{ Body: Record<string, never>; Headers: { "idempotency-key": string } }>(
    "/v1/personalization/memories/reset",
    {
      schema: {
        body: { type: "object", additionalProperties: false },
        headers: IdempotencyHeadersSchema,
        response: { 200: PersonalizationResetSchema, ...errors },
      },
    },
    (request) =>
      run("reset-memories", request.headers["idempotency-key"], request.body, async () => {
        await provider().resetMemories();
        return { success: true };
      }),
  );
  done();
};
