import { expect, it } from "vitest";
import { createCodexlyServer } from "./app.js";
import { createProvider, createServerOptions, closeCallbacks } from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
it("真实服务器在 ACP 与持久端口齐全时开放计划，旧运行时保持原入口", async () => {
  const h = createProvider();
  const store = await openRepository(await createWorkspace());
  const base = await h.provider.getCapabilities();
  h.provider.getCapabilities = () => Promise.resolve({ ...base, runtime: "acp" });
  const app = await createCodexlyServer({
    ...createServerOptions(h.provider),
    localCatalogStore: store,
    submissionRepository: store,
  });
  closeCallbacks.push(() => app.close());
  const list = await app.inject({ url: "/v1/acp/plans" });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json()).toEqual({ data: [], nextCursor: null });
  const legacy = await createCodexlyServer(createServerOptions(createProvider().provider));
  closeCallbacks.push(() => legacy.close());
  expect((await legacy.inject({ url: "/v1/acp/plans" })).statusCode).toBe(404);
});

it("启动时恢复已有领取，关闭后不再调度新计划", async () => {
  const h = createProvider();
  const store = await openRepository(await createWorkspace());
  const base = await h.provider.getCapabilities();
  h.provider.getCapabilities = () => Promise.resolve({ ...base, runtime: "acp" });
  const definition = (
    await import("../../../tests/fixtures/acp-scheduled-plan-definition.json", {
      with: { type: "json" },
    })
  ).default;
  const key = { source: "web" as const, scheduleId: "recover" };
  await store.catalog("acp.plan.commit", {
    ...key,
    definition: { ...definition, enabled: true } as never,
    resources: [],
    expectedRevision: 0,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  await store.catalog("acp.plan.claim", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 1,
    runId: "run",
    now: 10,
    nextRunAt: null,
  });
  const app = await createCodexlyServer({
    ...createServerOptions(h.provider),
    localCatalogStore: store,
    submissionRepository: store,
  });
  await app.ready();
  try {
    await expect
      .poll(async () => (await store.catalog("acp.plan.readRun", { ...key, runId: "run" }))?.status)
      .toBe("failed");
  } finally {
    await app.close();
  }
  await store.catalog("acp.plan.commit", {
    ...key,
    scheduleId: "after-close",
    definition: { ...definition, enabled: true } as never,
    resources: [],
    expectedRevision: 0,
    expectedStateRevision: 0,
    nextRunAt: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(
    (await store.catalog("acp.plan.readState", { ...key, scheduleId: "after-close" }))?.revision,
  ).toBe(1);
});

it("计划通知使用独立通道，双设备只在保存及删除持久成功后校准，幂等不重复", async () => {
  const h = createProvider();
  const store = await openRepository(await createWorkspace());
  const base = await h.provider.getCapabilities();
  h.provider.getCapabilities = () => Promise.resolve({ ...base, runtime: "acp" });
  h.provider.startConfiguredTurn = () => Promise.reject(Error("disabled draft"));
  const app = await createCodexlyServer({
    ...createServerOptions(h.provider),
    localCatalogStore: store,
    submissionRepository: store,
  });
  closeCallbacks.push(() => app.close());
  await app.ready();
  const messages: unknown[][] = [[], []];
  const sockets = await Promise.all(
    messages.map((frames) =>
      app.injectWS(
        "/v1/acp/plans/events",
        { headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" } },
        {
          onInit(socket) {
            socket.on("message", (data: { toString(): string }) =>
              frames.push(JSON.parse(data.toString())),
            );
          },
        },
      ),
    ),
  );
  try {
    await expect.poll(() => messages.map((frames) => frames.length)).toEqual([1, 1]);
    const definition = (
      await import("../../../tests/fixtures/acp-scheduled-plan-definition.json", {
        with: { type: "json" },
      })
    ).default;
    const request = {
      method: "PUT" as const,
      url: "/v1/acp/plans/push",
      headers: { "idempotency-key": "push" },
      payload: {
        definition: { ...definition, projectId: "codexly" },
        resources: [],
        expectedRevision: 0,
        expectedStateRevision: 0,
      },
    };
    const saved = await app.inject(request);
    expect(saved.statusCode, saved.body).toBe(200);
    await expect.poll(() => messages.map((frames) => frames.length)).toEqual([2, 2]);
    expect(messages).toEqual([
      [{ type: "acp-plans.changed" }, { type: "acp-plans.changed" }],
      [{ type: "acp-plans.changed" }, { type: "acp-plans.changed" }],
    ]);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(
      (await app.inject({ ...request, headers: { "idempotency-key": "stale" } })).statusCode,
    ).toBe(409);
    expect(messages.map((frames) => frames.length)).toEqual([2, 2]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: request.url,
          headers: { "idempotency-key": "delete" },
          payload: { expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(200);
    await expect.poll(() => messages.map((frames) => frames.length)).toEqual([3, 3]);
  } finally {
    sockets.forEach((socket) => {
      socket.terminate();
    });
  }
});
