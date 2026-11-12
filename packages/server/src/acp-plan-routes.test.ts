import type { AcpPlanView, AcpPlanPage } from "@codexly/protocol/acp-plan-api";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { fixture } from "./acp-plan-executor.test-support.js";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { AcpPlanService } from "./acp-plan-service.js";
import { registerAcpPlanRoutes } from "./routes/acp-plan-routes.js";
import { createIdempotencyRunner } from "./idempotency-runner.js";
import { MutationHttpError } from "./routes/context.js";
import { project } from "./app-all.test-support.js";
it("HTTP 新计划保存、读取、分页、幂等和删除保留旧目录与精简索引", async () => {
  const h = await fixture();
  const wake = vi.fn();
  const service = new AcpPlanService({
    catalog: h.store,
    getProjectContext: h.getProjectContext,
    agents: {},
    wake,
  });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MutationHttpError) reply.code(error.statusCode).send({ code: error.code });
    else reply.send(error);
  });
  app.register(registerAcpPlanRoutes, {
    service,
    catalog: h.store,
    runIdempotent: createIdempotencyRunner(20, 60_000).run,
  });
  const payload = {
    definition: { ...definition, values: { mode: false, "vendor/~key": true, "line\nkey": false } },
    resources: [],
    expectedRevision: 0,
    expectedStateRevision: 0,
  };
  try {
    const write = () =>
      app.inject({
        method: "PUT",
        url: "/v1/acp/plans/edit",
        payload,
        headers: { "idempotency-key": "stable" },
      });
    const first = await write();
    expect(first.statusCode, first.body).toBe(200);
    const view = first.json<AcpPlanView>();
    expect(view).toMatchObject({
      revision: 1,
      definition: { values: { mode: false } },
      state: { revision: 1, nextRunAt: null },
    });
    expect((await write()).json()).toEqual(view);
    expect(wake).toHaveBeenCalledTimes(1);
    const read = await app.inject({ url: "/v1/acp/plans/edit" });
    expect(read.json()).toEqual(view);
    expect(read.headers["cache-control"]).toBe("no-store");
    const history = await app.inject({ url: "/v1/acp/plans/plan/history" });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json()).toMatchObject({ projectId: project.id, data: [{ status: "claimed" }] });
    expect(history.body).not.toContain('"definition":');
    expect(history.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ url: "/v1/acp/plans/missing/history" })).statusCode).toBe(404);
    const page = await app.inject({ url: "/v1/acp/plans?limit=1" });
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json<AcpPlanPage>().data[0]).not.toHaveProperty("prompt");
    expect(page.json<AcpPlanPage>().nextCursor).toBe("edit");
    expect(
      (await app.inject({ url: "/v1/acp/plans?limit=1&after=edit" })).json<AcpPlanPage>().data[0]
        ?.scheduleId,
    ).toBe("plan");
    const busy = await app.inject({
      method: "DELETE",
      url: "/v1/acp/plans/plan",
      payload: { expectedRevision: 1 },
      headers: { "idempotency-key": "busy" },
    });
    expect(busy.statusCode, busy.body).toBe(409);
    const stale = await app.inject({
      method: "DELETE",
      url: "/v1/acp/plans/edit",
      payload: { expectedRevision: 2 },
      headers: { "idempotency-key": "stale" },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/acp/plans/edit",
          payload: { expectedRevision: 1 },
          headers: { "idempotency-key": "delete" },
        })
      ).json(),
    ).toEqual({ deleted: true });
    expect((await app.inject({ url: "/v1/acp/plans/edit" })).statusCode).toBe(404);
    expect(await h.store.listScheduledTasks()).toEqual([]);
  } finally {
    await app.close();
  }
});

it("交付继承配对认证，拒绝路径 / 来源注入和隐式转换，暂存复用授权端口与取消信号", async () => {
  const h = await fixture();
  const controller = new AbortController();
  const stage = vi.fn(() =>
    Promise.resolve({
      token: "token",
      attachment: { id: "ref", kind: "file" as const, mediaType: "x", name: "a", size: 1 },
      digest: "a".repeat(64),
      written: 1,
      boundRevision: null,
    }),
  );
  const service = new AcpPlanService({
    catalog: h.store,
    getProjectContext: h.getProjectContext,
    agents: {},
    resources: { stage },
  });
  const app = Fastify();
  app.decorateRequest("signal", { getter: () => controller.signal });
  app.addHook("onRequest", (request, reply, next) => {
    if (request.headers.authorization !== "paired") {
      reply.code(401).send({ code: "UNAUTHORIZED" });
      return;
    }
    next();
  });
  app.register(registerAcpPlanRoutes, {
    service,
    catalog: h.store,
    runIdempotent: createIdempotencyRunner(20, 60_000).run,
  });
  const input = { definition, resources: [], expectedRevision: 0, expectedStateRevision: 0 };
  const headers = { authorization: "paired", "idempotency-key": "invalid" };
  try {
    expect((await app.inject({ url: "/v1/acp/plans" })).statusCode).toBe(401);
    for (const payload of [
      { ...input, source: "desktop" },
      { ...input, cwd: "/injected" },
      { ...input, nextRunAt: 1 },
      { ...input, definition: { ...definition, enabled: "false" } },
      { ...input, definition: { ...definition, turnOptions: {} } },
    ]) {
      expect(
        (await app.inject({ method: "PUT", url: "/v1/acp/plans/invalid", headers, payload }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/acp/plans/invalid",
          headers: { authorization: "paired" },
          payload: input,
        })
      ).statusCode,
    ).toBe(400);
    for (const query of ["limit=101", "limit=01", "limit=0", "source=desktop", "limit=false"])
      expect((await app.inject({ url: `/v1/acp/plans?${query}`, headers })).statusCode).toBe(400);
    const upload = () =>
      app.inject({
        method: "POST",
        url: "/v1/acp/plans/new/resources",
        headers: { ...headers, "idempotency-key": "upload" },
        payload: { projectId: "p", uploadId: "upload" },
      });
    expect((await upload()).statusCode).toBe(200);
    expect((await upload()).statusCode).toBe(200);
    expect(stage).toHaveBeenCalledExactlyOnceWith(
      { source: "web", scheduleId: "new", projectId: "p" },
      "upload",
      controller.signal,
    );
    expect(
      await h.store.catalog("acp.plan.read", { source: "web", scheduleId: "invalid" }),
    ).toBeNull();
  } finally {
    await app.close();
  }
});
