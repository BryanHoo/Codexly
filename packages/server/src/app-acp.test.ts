import { expect, it, vi } from "vitest";
import type { AcpAgentServices } from "@codexly/core";
import { createCodexlyServer } from "./app.js";
import { createProvider, createServerOptions, closeCallbacks } from "./app-all.test-support.js";

const profile = {
  engine: "claude" as const,
  protocolVersion: 1,
  authStatus: { kind: "api_key" as const, label: "Anthropic API key", detail: "ANTHROPIC_API_KEY" },
  authMethods: [{ id: "login", name: "登录" }],
};
const defaults = {
  configOptions: [{ id: "enabled", name: "开关", type: "boolean" as const, currentValue: false }],
  defaults: { enabled: false },
  unmappedLegacy: [],
  invalidDefaults: [],
};
it("服务装配直接使用运行时公布的 ACP 服务端口，无需另注入供应商适配器", async () => {
  const base = createServerOptions(createProvider().provider);
  const service = {
    inspect: () => Promise.resolve(profile),
    readDefaults: () => Promise.resolve(defaults),
    updateDefaults: () => Promise.resolve(defaults),
    setDefaultConfig: () => Promise.resolve(defaults),
    authenticate: () => Promise.resolve({}),
  };
  const app = await createCodexlyServer({
    ...base,
    provider: { ...base.provider, acpAgents: { codex: service, claude: service } },
  });
  closeCallbacks.push(() => app.close());
  const response = await app.inject({ method: "GET", url: "/v1/acp/agents/claude" });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual(profile);
});
it("ACP 路由独立选择引擎、保留布尔值，并为认证与设置保持幂等", async () => {
  const claude = {
    inspect: vi.fn(() => Promise.resolve(profile)),
    readDefaults: vi.fn(() => Promise.resolve(defaults)),
    updateDefaults: vi.fn(() => Promise.resolve(defaults)),
    setDefaultConfig: vi.fn(() => Promise.resolve(defaults)),
    authenticate: vi.fn(() => Promise.resolve({})),
  };
  const codex = {
    ...claude,
    inspect: vi.fn(() => Promise.resolve({ ...profile, engine: "codex" as const })),
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    acpAgents: { codex, claude } satisfies AcpAgentServices,
  });
  closeCallbacks.push(() => app.close());
  const response = await app.inject({ method: "GET", url: "/v1/acp/agents/claude" });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual(profile);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(codex.inspect).not.toHaveBeenCalled();
  for (let i = 0; i < 2; i++) {
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/acp/agents/claude/defaults",
      payload: { values: { enabled: false } },
      headers: { "idempotency-key": "acp-settings" },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual(defaults);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/acp/agents/claude/authenticate",
          payload: { methodId: "login" },
          headers: { "idempotency-key": "acp-login" },
        })
      ).statusCode,
    ).toBe(200);
  }
  expect(claude.updateDefaults).toHaveBeenCalledExactlyOnceWith({ enabled: false });
  expect(claude.authenticate).toHaveBeenCalledOnce();
  expect(claude.authenticate.mock.calls[0]).toMatchObject(["login", expect.any(AbortSignal)]);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/v1/acp/agents/claude/defaults",
        payload: { values: { enabled: true } },
        headers: { "idempotency-key": "acp-settings" },
      })
    ).statusCode,
  ).toBe(409);
  for (const payload of [{ values: { enabled: 1 } }, { values: {}, extra: "reject" }])
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/acp/agents/claude/defaults",
          payload,
          headers: { "idempotency-key": "invalid" },
        })
      ).statusCode,
    ).toBe(400);
});

it("单项默认配置使用严格 PATCH 契约、保持 false 和幂等完整响应", async () => {
  const setDefaultConfig = vi.fn(() => Promise.resolve(defaults));
  const service = {
    inspect: () => Promise.resolve(profile),
    readDefaults: () => Promise.resolve(defaults),
    updateDefaults: () => Promise.resolve(defaults),
    authenticate: () => Promise.resolve({}),
    setDefaultConfig,
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => app.close());
  const url = "/v1/acp/agents/claude/defaults";
  for (let i = 0; i < 2; i++) {
    const response = await app.inject({
      method: "PATCH",
      url,
      payload: { configId: "enabled", value: false },
      headers: { "idempotency-key": "patch-once" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual(defaults);
    expect(response.headers["cache-control"]).toBe("no-store");
  }
  expect(setDefaultConfig).toHaveBeenCalledExactlyOnceWith("enabled", false);
  expect(
    (
      await app.inject({
        method: "PATCH",
        url,
        payload: { configId: "enabled", value: true },
        headers: { "idempotency-key": "patch-once" },
      })
    ).statusCode,
  ).toBe(409);
  for (const payload of [
    { configId: "enabled", value: 0 },
    { configId: "enabled", value: false, extra: true },
  ])
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          payload,
          headers: { "idempotency-key": "invalid-patch" },
        })
      ).statusCode,
    ).toBe(400);
});

it("LAN 认证先于 ACP 访问，未注入服务明确不可用", async () => {
  const service = {
    inspect: vi.fn(() => Promise.resolve(profile)),
    readDefaults: vi.fn(() => Promise.resolve(defaults)),
    updateDefaults: vi.fn(() => Promise.resolve(defaults)),
    setDefaultConfig: vi.fn(() => Promise.resolve(defaults)),
    authenticate: vi.fn(() => Promise.resolve({})),
  };
  const lan = await createCodexlyServer({
    ...createServerOptions(createProvider().provider, { access: { pairingCode: "pair" } }),
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => lan.close());
  expect((await lan.inject({ method: "GET", url: "/v1/acp/agents/claude" })).statusCode).toBe(401);
  expect(service.inspect).not.toHaveBeenCalled();
  const app = await createCodexlyServer(createServerOptions(createProvider().provider));
  closeCallbacks.push(() => app.close());
  expect((await app.inject({ method: "GET", url: "/v1/acp/agents/codex" })).statusCode).toBe(503);
});

it("会话配置验证项目与任务身份并保持原始取值", async () => {
  const h = createProvider();
  const task = await h.startTask();
  const base = createServerOptions(h.provider);
  const readSessionConfiguration = vi.fn(() => Promise.resolve(defaults.configOptions));
  const sessionState = {
    configOptions: defaults.configOptions,
    availableCommands: [{ name: "review", description: "检查", input: { hint: "范围" } }],
  };
  const readSessionState = vi.fn(() => Promise.resolve(sessionState));
  const setSessionConfiguration = vi.fn(() => Promise.resolve(defaults.configOptions));
  const readTaskMetadata = vi.fn((id: string) =>
    Promise.resolve(id === task.id ? { ...task, projectId: "codexly" } : undefined),
  );
  const app = await createCodexlyServer({
    ...base,
    provider: {
      ...base.provider,
      forProject: (project) => ({
        ...base.provider.forProject(project),
        readTaskMetadata,
        readSessionConfiguration,
        readSessionState,
        setSessionConfiguration,
      }),
    },
  });
  closeCallbacks.push(() => app.close());
  const url = `/v1/projects/codexly/tasks/${task.id}/acp/config`;
  const session = await app.inject({
    method: "GET",
    url: `/v1/projects/codexly/tasks/${task.id}/acp/session`,
  });
  expect(session.statusCode, session.body).toBe(200);
  expect(session.json()).toEqual(sessionState);
  expect(
    (await app.inject({ method: "GET", url: "/v1/projects/codexly/tasks/foreign/acp/session" }))
      .statusCode,
  ).toBe(404);
  expect(readSessionState).toHaveBeenCalledExactlyOnceWith(task.id);
  const read = await app.inject({ method: "GET", url });
  expect(read.statusCode, read.body).toBe(200);
  expect(read.json()).toEqual(defaults.configOptions);
  const saved = await app.inject({
    method: "PUT",
    url,
    payload: { configId: "enabled", value: false },
    headers: { "idempotency-key": "session-config" },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(setSessionConfiguration).toHaveBeenCalledExactlyOnceWith(task.id, "enabled", false);
  expect(
    (await app.inject({ method: "GET", url: "/v1/projects/codexly/tasks/foreign/acp/config" }))
      .statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ method: "GET", url: `/v1/projects/missing/tasks/${task.id}/acp/config` }))
      .statusCode,
  ).toBe(404);
  expect(readSessionConfiguration).toHaveBeenCalledOnce();
});

it("供应商 HTTP 配置使用通用 ACP 契约并保持幂等，不回显密钥", async () => {
  const page = {
    providers: [{ providerId: "main", supported: ["openai"], required: false, current: null }],
    restartRequired: true,
  };
  const providers = {
    list: vi.fn(() => Promise.resolve(page)),
    configure: vi.fn(() => Promise.resolve(page)),
    disable: vi.fn(() => Promise.resolve(page)),
  };
  const service = {
    providers,
    inspect: () => Promise.resolve(profile),
    readDefaults: () => Promise.resolve(defaults),
    updateDefaults: () => Promise.resolve(defaults),
    setDefaultConfig: () => Promise.resolve(defaults),
    authenticate: () => Promise.resolve({}),
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => app.close());
  const url = "/v1/acp/agents/claude/providers";
  expect((await app.inject({ method: "GET", url })).json()).toEqual(page);
  const config = {
    providerId: "main",
    apiType: "openai",
    baseUrl: "https://gateway.example",
    headers: { authorization: "secret" },
  };
  for (let i = 0; i < 2; i++) {
    const response = await app.inject({
      method: "PUT",
      url,
      payload: config,
      headers: { "idempotency-key": "provider-once" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain("secret");
  }
  expect(providers.configure).toHaveBeenCalledExactlyOnceWith(config);
  expect(
    (
      await app.inject({
        method: "DELETE",
        url: `${url}/main`,
        headers: { "idempotency-key": "disable-once" },
      })
    ).statusCode,
  ).toBe(200);
  expect(providers.disable).toHaveBeenCalledExactlyOnceWith("main");
});

it("认证表单凭据通过 HTTP 到达服务，响应不回显秘密", async () => {
  const authenticate = vi.fn(() => Promise.resolve({}));
  const service = {
    inspect: () => Promise.resolve(profile),
    readDefaults: () => Promise.resolve(defaults),
    updateDefaults: () => Promise.resolve(defaults),
    setDefaultConfig: () => Promise.resolve(defaults),
    authenticate,
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/v1/acp/agents/codex/authenticate",
    headers: { "idempotency-key": "form-key" },
    payload: { methodId: "api-key", credentials: { apiKey: "private-form-key" } },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(authenticate).toHaveBeenCalledWith("api-key", expect.any(AbortSignal), {
    apiKey: "private-form-key",
  });
  expect(response.body).not.toContain("private-form-key");
});
