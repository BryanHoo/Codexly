import Fastify, { type FastifyInstance } from "fastify";
import type { TokenUsageResponse } from "@codexly/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { registerTokenUsageRoutes } from "./token-usage-routes.js";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
test("validates a bounded calendar query and never starts an engine", async () => {
  const app = Fastify();
  apps.push(app);
  const catalog = vi.fn().mockResolvedValue({
    days: [
      {
        day: "2026-10-22",
        engine: "codex",
        taskCount: 1,
        totalTokens: 42,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ],
    tasks: [],
  });
  registerTokenUsageRoutes(app, { catalog });
  const response = await app.inject("/v1/usage?year=2026&engine=codex");
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.json<TokenUsageResponse>().days[0]).toMatchObject({
    totalTokens: 42,
    inputTokens: null,
  });
  expect(catalog).toHaveBeenCalledWith("usage.query", { year: 2026, engine: "codex" });
  catalog.mockClear();
  for (const query of ["year=1999", "year=10000", "year=2026&engine=unknown", "year=2026&day=oops"])
    expect((await app.inject(`/v1/usage?${query}`)).statusCode).toBe(400);
  expect(catalog).not.toHaveBeenCalled();
});
