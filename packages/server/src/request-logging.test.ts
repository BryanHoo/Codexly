import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CodexlyLogController } from "./server-runtime.js";

describe("request logging", () => {
  it("warns on slow reads, excludes sockets and records response failures", () => {
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const request = {
      id: "r1",
      method: "GET",
      params: {},
      log,
      routeOptions: { url: "/v1/tasks", config: {} },
    } as unknown as FastifyRequest;
    const reply = { elapsedTime: 3_001, statusCode: 200 } as FastifyReply;
    const controller = new CodexlyLogController();
    controller.requestCompleted(null, request, reply);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 3_001 }),
      "slow request completed",
    );
    log.warn.mockClear();
    request.ws = true;
    controller.requestCompleted(null, request, reply);
    expect(log.warn).not.toHaveBeenCalled();
    controller.requestCompleted(new Error("sensitive"), request, reply);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "REQUEST_FAILED" }),
      "request completed",
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("sensitive");
  });
  it("keeps reads quiet and records mutations and failures with safe context", async () => {
    const logs: Record<string, unknown>[] = [];
    const app = Fastify({
      logController: new CodexlyLogController(),
      logger: {
        level: "info",
        stream: {
          write: (line: string) => {
            logs.push(JSON.parse(line) as Record<string, unknown>);
          },
        },
      },
    });
    app.get("/v1/health", () => ({ ok: true }));
    app.get("/v1/tasks", () => []);
    app.post("/v1/projects/:projectId/tasks/:taskId/turns", () => ({ ok: true }));
    app.post("/v1/failure", (_request, reply) => reply.code(409).send({ code: "CONFLICT" }));
    try {
      await app.inject("/v1/health");
      await app.inject("/v1/tasks");
      await app.inject("/missing?secret=hidden");
      await app.inject({
        method: "POST",
        url: "/v1/projects/p1/tasks/t1/turns?secret=hidden",
        payload: { prompt: "hidden" },
      });
      await app.inject({ method: "POST", url: "/v1/failure" });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ level: 30, projectId: "p1", taskId: "t1", statusCode: 200 });
      expect(logs[1]).toMatchObject({ level: 40, statusCode: 409 });
      expect(JSON.stringify(logs)).not.toContain("hidden");
    } finally {
      await app.close();
    }
  });
});
