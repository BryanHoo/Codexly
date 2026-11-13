import { expect, it, vi } from "vitest";
import { CodexlyClient, CodexlyResponseError } from "./http-client.js";

it("计划 ACP 配置使用独立端点，保留归属、修订号、确认和布尔值", async () => {
  const view = {
    projectId: "p",
    canEdit: true,
    config: { engine: "claude", values: { mode: false }, revision: 1 },
  };
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(view))),
  );
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  const input = {
    projectId: "p",
    engine: "claude" as const,
    values: { mode: false },
    expectedRevision: 0,
    confirmMigration: true,
  };
  expect(await client.getAcpScheduledConfig("plan/id")).toEqual(view);
  expect(await client.setAcpScheduledConfig("plan/id", input, { idempotencyKey: "once" })).toEqual(
    view,
  );
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://example.test/v1/scheduled-tasks/plan%2Fid/acp-config",
  );
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify(input),
    headers: { "idempotency-key": "once" },
  });
});

it("单项默认配置通过 PATCH 发送原始 ID 和 false", async () => {
  const result = {
    configOptions: [],
    defaults: { enabled: false },
    unmappedLegacy: [],
    invalidDefaults: [],
  };
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(result))),
  );
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  expect(
    await client.setAcpDefaultConfig("claude", "enabled", false, { idempotencyKey: "once" }),
  ).toEqual(result);
  expect(fetch).toHaveBeenCalledWith(
    "https://example.test/v1/acp/agents/claude/defaults",
    expect.objectContaining({
      method: "PATCH",
      body: '{"configId":"enabled","value":false}',
    }),
  );
  expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "idempotency-key": "once" });
});

it("通过共享认证传输读取 ACP 契约，变更保留幂等键与取消信号", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ engine: "claude", protocolVersion: 1, authMethods: [] })),
    );
  const client = new CodexlyClient({ baseUrl: "http://localhost:3210", fetch });
  expect(await client.getAcpAgent("claude")).toMatchObject({ engine: "claude" });
  expect(fetch.mock.calls[0]).toMatchObject([
    "http://localhost:3210/v1/acp/agents/claude",
    { credentials: "same-origin" },
  ]);
  fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        configOptions: [],
        defaults: { enabled: false },
        unmappedLegacy: [],
        invalidDefaults: [],
      }),
    ),
  );
  expect(
    await client.updateAcpDefaults("claude", { enabled: false }, { idempotencyKey: "same-write" }),
  ).toMatchObject({ defaults: { enabled: false } });
  expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({
    method: "PUT",
    headers: { "idempotency-key": "same-write" },
    body: '{"values":{"enabled":false}}',
  });
  fetch.mockResolvedValue(new Response("{}"));
  await client.authenticateAcpAgent("claude", "login", { idempotencyKey: "same-login" });
  expect(fetch.mock.calls.at(-1)).toMatchObject([
    "http://localhost:3210/v1/acp/agents/claude/authenticate",
    { method: "POST", body: '{"methodId":"login"}' },
  ]);
  fetch.mockResolvedValue(new Response(JSON.stringify({ configOptions: "broken", defaults: {} })));
  await expect(client.getAcpDefaults("claude")).rejects.toBeInstanceOf(CodexlyResponseError);
  const controller = new AbortController();
  controller.abort();
  fetch.mockClear();
  await expect(client.getAcpAgent("claude", { signal: controller.signal })).rejects.toThrow();
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it("会话配置 URL 编码应用身份，布尔变更仍使用共享幂等传输", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(new Response("[]")));
  const client = new CodexlyClient({ baseUrl: "http://localhost:3210", fetch });
  expect(await client.getAcpSessionConfig("project/id", "task/id")).toEqual([]);
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "http://localhost:3210/v1/projects/project%2Fid/tasks/task%2Fid/acp/config",
  );
  await client.setAcpSessionConfig("project/id", "task/id", "mode", false, {
    idempotencyKey: "config-once",
  });
  expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({
    method: "PUT",
    body: '{"configId":"mode","value":false}',
    headers: { "idempotency-key": "config-once" },
  });
  const state = {
    configOptions: [],
    availableCommands: [{ name: "review", description: "检查", input: { hint: "范围" } }],
  };
  fetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(state))));
  expect(await client.getAcpSessionState("project/id", "task/id")).toEqual(state);
  expect(fetch.mock.calls.at(-1)?.[0]).toBe(
    "http://localhost:3210/v1/projects/project%2Fid/tasks/task%2Fid/acp/session",
  );
});

it("供应商客户端保留原始 ACP 配置字段和幂等键", async () => {
  const page = { providers: [], restartRequired: true };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(page))));
  const client = new CodexlyClient({ baseUrl: "http://localhost:3210", fetch });
  expect(await client.getAcpProviders("claude")).toEqual(page);
  const config = {
    providerId: "gateway",
    apiType: "openai",
    baseUrl: "https://gateway.example",
    headers: { authorization: "secret" },
  };
  await client.configureAcpProvider("claude", config, { idempotencyKey: "provider-once" });
  expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify(config),
    headers: { "idempotency-key": "provider-once" },
  });
  await client.disableAcpProvider("claude", "gateway/id");
  expect(fetch.mock.calls.at(-1)?.[0]).toBe(
    "http://localhost:3210/v1/acp/agents/claude/providers/gateway%2Fid",
  );
});

it("草稿预览使用项目 URL 和独立请求契约，不携带默认设置写入", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ configOptions: [], values: { enabled: false } })),
    ),
  );
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  await client.previewAcpConfig("p /", "claude", {
    values: { enabled: false },
    change: { configId: "enabled", value: false },
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://example.test/v1/projects/p%20%2F/acp/claude/preview",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        values: { enabled: false },
        change: { configId: "enabled", value: false },
      }),
    }),
  );
});

it("认证表单将密钥放入请求体，不进入查询字符串或响应缓存", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response("{}")));
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  await client.authenticateAcpAgent("codex", "api-key", {
    idempotencyKey: "credentials",
    credentials: { apiKey: "private-form-key" },
  });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/v1/acp/agents/codex/authenticate");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ methodId: "api-key", credentials: { apiKey: "private-form-key" } }),
  });
});
