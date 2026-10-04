import { AgentMutationErrorSchema, HistoryCompressionResultSchema } from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema } from "./schemas.js";

export const registerHistoryStorageRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  app.post<{ Body: Record<string, never>; Headers: { "idempotency-key": string } }>(
    "/v1/history/compress",
    {
      schema: {
        body: { type: "object", additionalProperties: false },
        headers: IdempotencyHeadersSchema,
        response: {
          200: HistoryCompressionResultSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    (request) =>
      context.runIdempotent(
        ["compress-history"],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const storage = context.provider.historyStorage;
          if (storage === undefined)
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              "History compression is unavailable",
              503,
              true,
            );
          try {
            return await storage.compress();
          } catch (error) {
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              error instanceof Error ? error.message : "History compression request failed",
              502,
              true,
            );
          }
        },
      ),
  );
  done();
};
