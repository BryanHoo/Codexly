import type { FastifyInstance } from "fastify";
import type { LocalCatalogStore } from "@codexly/core";
import {
  SavedPromptsRequestSchema,
  SavedPromptsSchema,
  type SavedPromptsRequest,
} from "@codexly/protocol";

/** 沿用应用访问认证，不依赖引擎能力；响应禁止被浏览器或代理缓存。 */
export function registerSavedPromptsRoutes(app: FastifyInstance, store?: LocalCatalogStore): void {
  app.post<{ Body: SavedPromptsRequest }>(
    "/v1/saved-prompts",
    {
      // 每批迁移最多 100 条旧提示词，兼容中文正文及 JSON 控制字符转义后的体积。
      bodyLimit: 16 * 1024 * 1024,
      schema: { body: SavedPromptsRequestSchema, response: { 200: SavedPromptsSchema } },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!store) return reply.code(503).send({ message: "Prompt storage is unavailable" });
      try {
        return await store.catalog("prompts.sync", request.body);
      } catch (error) {
        if (error instanceof Error && error.message === "duplicate")
          return reply.code(409).send({ message: "duplicate" });
        throw error;
      }
    },
  );
}
