import { expect, it, vi } from "vitest";
import { CodexlyClient, CodexlyResponseError } from "./http-client.js";

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
