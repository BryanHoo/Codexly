import type { FastifyInstance } from "fastify";
import type { LocalCatalogStore } from "@codexly/core";
import {
  TokenUsageQuerySchema,
  TokenUsageResponseSchema,
  type TokenUsageQuery,
} from "@codexly/protocol";

/** 复用全局访问控制；查询只读取有索引的日汇总，不唤醒 Codex 或 Claude 进程。 */
export function registerTokenUsageRoutes(app: FastifyInstance, store?: LocalCatalogStore): void {
  app.get<{ Querystring: TokenUsageQuery }>(
    "/v1/usage",
    {
      schema: { querystring: TokenUsageQuerySchema, response: { 200: TokenUsageResponseSchema } },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!store) return reply.code(503).send({ message: "Usage storage is unavailable" });
      return store.catalog("usage.query", request.query);
    },
  );
}
