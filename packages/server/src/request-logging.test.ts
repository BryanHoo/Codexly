import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CodexlyLogController } from "./server-runtime.js";
import { recordRequestError } from "./request-logging.js";

describe("request logging", () => {
  it("retains bounded diagnostic causes and stable fingerprints without logging exception text", () => {
    const log = {
      error: vi.fn<(fields: Record<string, unknown>, message: string) => void>(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    const request = {
      id: "r1",
      method: "GET",
      params: {},
      log,
      routeOptions: { url: "/v1/tasks" },
    } as unknown as FastifyRequest;
    const reply = { elapsedTime: 1, statusCode: 500 } as FastifyReply;
    const controller = new CodexlyLogController();
    const failure = (secret: string) => {
      const cause = Object.assign(new Error(secret), { code: "ECONNRESET" });
      cause.cause = cause;
      const error = new TypeError(secret, { cause });
      error.stack = `TypeError: ${secret}\n    at read (/private/project/packages/server/src/tasks.ts:42:3)`;
      return error;
    };
    for (const secret of ["credential-one", "body-two"]) {
      recordRequestError(request, "INTERNAL_ERROR", failure(secret));
      controller.requestCompleted(null, request, reply);
    }
    const first = log.error.mock.calls[0]?.[0];
    expect(first).toMatchObject({
      errorCode: "INTERNAL_ERROR",
      errorClass: "TypeError",
      component: "http",
      phase: "handler",
      causes: [{ errorClass: "Error", systemCode: "ECONNRESET" }],
    });
    expect(first?.["errorFingerprint"]).toMatch(/^[a-f0-9]{24}$/);
    expect(log.error.mock.calls[1]?.[0]["errorFingerprint"]).toBe(first?.["errorFingerprint"]);
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(
      /credential-one|body-two|private|tasks\.ts/,
    );
    controller.requestCompleted(null, request, reply);
    expect(log.error.mock.calls[2]?.[0]).not.toHaveProperty("errorFingerprint");
  });
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
