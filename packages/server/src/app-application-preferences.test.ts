import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { createProvider, createServerOptions, closeCallbacks } from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("应用偏好从旧仓储只读投影，读写不调用任何引擎或原生配置", async () => {
  const store = await openRepository(await createWorkspace());
  const h = createProvider(),
    options = createServerOptions(h.provider);
  const nativeDefaults = vi.spyOn(options.provider, "readDefaultSettings");
  const app = await createCodexlyServer({
    ...options,
    localCatalogStore: store,
    settingsRepository: store,
  });
  closeCallbacks.push(() => app.close());
  const models = vi.spyOn(h.provider, "listModels");
  const empty = await app.inject({ url: "/v1/application-preferences" });
  expect(empty.statusCode, empty.body).toBe(200);
  expect(empty.json()).toMatchObject({ defaultAgent: "codex", defaultModel: null });
  await store.writeGlobalSettings({
    defaultAgent: "claude",
    defaultModel: "old-generation",
    commitMessagePrompt: "旧提交规则",
    taskTitlePrompt: "旧标题规则",
    promptOptimizationPrompt: "旧优化规则",
    defaultOpenAppId: "zed",
    followUpBehavior: "steer",
    pet: { enabled: true, selectedPetId: "old-pet" },
    model: "旧运行模型",
    reasoningEffort: "high",
    sandboxMode: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    fastMode: false,
    modelContextWindow: null,
  });
  const imported = await app.inject({ url: "/v1/application-preferences" });
  expect(imported.json()).toEqual({
    defaultAgent: "claude",
    defaultModel: "old-generation",
    commitMessagePrompt: "旧提交规则",
    taskTitlePrompt: "旧标题规则",
    promptOptimizationPrompt: "旧优化规则",
    defaultOpenAppId: "zed",
    followUpBehavior: "steer",
    pet: { enabled: true, selectedPetId: "old-pet" },
  });
  const old = await store.readGlobalSettings();
  const saved = await app.inject({
    method: "PATCH",
    url: "/v1/application-preferences",
    headers: { "idempotency-key": "first" },
    payload: {
      defaultAgent: "claude",
      defaultModel: "raw/provider/model",
      taskTitlePrompt: "标题",
    },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toMatchObject({
    defaultAgent: "claude",
    defaultModel: "raw/provider/model",
    taskTitlePrompt: "标题",
    commitMessagePrompt: "旧提交规则",
    promptOptimizationPrompt: "旧优化规则",
    followUpBehavior: "steer",
  });
  expect(await store.readGlobalSettings()).toEqual(old);
  expect((await app.inject({ url: "/v1/application-preferences" })).json()).toEqual(saved.json());
  expect(models).not.toHaveBeenCalled();
  expect(nativeDefaults).not.toHaveBeenCalled();
  expect(saved.headers["cache-control"]).toBe("no-store");
  await app.inject({
    method: "PATCH",
    url: "/v1/application-preferences",
    headers: { "idempotency-key": "second" },
    payload: { defaultAgent: "codex", defaultModel: null },
  });
  const replay = await app.inject({
    method: "PATCH",
    url: "/v1/application-preferences",
    headers: { "idempotency-key": "first" },
    payload: {
      defaultAgent: "claude",
      defaultModel: "raw/provider/model",
      taskTitlePrompt: "标题",
    },
  });
  expect(replay.json()).toEqual(saved.json());
  expect((await app.inject({ url: "/v1/application-preferences" })).json()).toMatchObject({
    defaultModel: null,
  });
  for (const payload of [
    {},
    { defaultModel: "x" },
    { model: "x" },
    { taskTitlePrompt: "x", baseline: {} },
    { pet: { enabled: true, selectedPetId: null } },
  ]) {
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/application-preferences",
          headers: { "idempotency-key": crypto.randomUUID() },
          payload,
        })
      ).statusCode,
    ).toBe(400);
  }
  const tooLarge = {
    defaultAgent: "codex",
    defaultModel: "\0".repeat(16384),
    pet: { enabled: false, selectedPetId: "\0".repeat(16384) },
    commitMessagePrompt: "\0".repeat(4000),
    taskTitlePrompt: "\0".repeat(4000),
    promptOptimizationPrompt: "\0".repeat(4000),
  };
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/application-preferences",
        headers: { "idempotency-key": "oversized" },
        payload: tooLarge,
      })
    ).statusCode,
  ).toBe(413);
});

it("局域网偏好读写沿用配对认证，认证前不读取旧配置", async () => {
  const store = await openRepository(await createWorkspace());
  const source = vi.spyOn(store, "readGlobalSettings");
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider, {
      access: { pairingCode: "preferences-test", sessionTtlMs: 86400000 },
    }),
    localCatalogStore: store,
    settingsRepository: store,
  });
  closeCallbacks.push(() => app.close());
  expect((await app.inject({ url: "/v1/application-preferences" })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/application-preferences",
        headers: { "idempotency-key": "blocked" },
        payload: { taskTitlePrompt: "x" },
      })
    ).statusCode,
  ).toBe(401);
  expect(source).not.toHaveBeenCalled();
  const paired = await app.inject({
    method: "POST",
    url: "/v1/access/pair",
    payload: { code: "preferences-test" },
  });
  const cookies = paired.headers["set-cookie"];
  const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
  const response = await app.inject({ url: "/v1/application-preferences", headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  expect(source).toHaveBeenCalledOnce();
});
