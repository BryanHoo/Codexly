import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { createProvider, createServerOptions, closeCallbacks } from "./app-all.test-support.js";
import type { AcpConfigPreviewRequest } from "@codexly/protocol";
it("预览只采用服务端项目目录且保留布尔值，不写默认值或创建任务", async () => {
  const previewConfig = vi.fn(
    (_cwd: string, _input: AcpConfigPreviewRequest, _signal?: AbortSignal) =>
      Promise.resolve({ configOptions: [], values: { enabled: false } }),
  );
  const write = vi.fn();
  const provider = createProvider().provider;
  const service = {
    inspect: vi.fn(),
    readDefaults: write,
    updateDefaults: write,
    setDefaultConfig: write,
    authenticate: vi.fn(),
    previewConfig,
  };
  const options = createServerOptions(provider);
  const app = await createCodexlyServer({
    ...options,
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => app.close());
  const project = await app.inject({ method: "GET", url: "/v1/projects" });
  const projectId = project.json<{ data: { id: string }[] }>().data[0]?.id;
  if (!projectId) throw new Error("测试项目未创建");
  const response = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/acp/claude/preview`,
    payload: { values: { enabled: false } },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(previewConfig).toHaveBeenCalledWith(
    expect.any(String),
    { values: { enabled: false } },
    expect.any(AbortSignal),
  );
  expect(write).not.toHaveBeenCalled();
  const trusted = previewConfig.mock.calls[0]?.[0];
  const scoped = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/acp/claude/preview`,
    payload: { values: {}, workspacePath: trusted },
  });
  expect(scoped.statusCode, scoped.body).toBe(200);
  expect(previewConfig).toHaveBeenLastCalledWith(
    trusted,
    { values: {}, workspacePath: trusted },
    expect.any(AbortSignal),
  );
  const unrelated = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/acp/claude/preview`,
    payload: { values: {}, workspacePath: "/secret-acp-unrelated" },
  });
  expect(unrelated.statusCode).toBe(400);
  const bad = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/acp/claude/preview`,
    payload: { values: {}, cwd: "/secret" },
  });
  expect(bad.statusCode).toBe(400);
  expect(previewConfig).toHaveBeenCalledTimes(2);
});

it("真实 HTTP 预览不因 POST 正文结束而被取消", async () => {
  const previewConfig = vi.fn(
    async (_cwd: string, _input: AcpConfigPreviewRequest, signal?: AbortSignal) => {
      // 给真实 IncomingMessage 的正常 close 事件一次派发机会，inject 不会复现该行为。
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      signal?.throwIfAborted();
      return { configOptions: [], values: {} };
    },
  );
  const service = {
    inspect: vi.fn(),
    readDefaults: vi.fn(),
    updateDefaults: vi.fn(),
    setDefaultConfig: vi.fn(),
    authenticate: vi.fn(),
    previewConfig,
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    handlerTimeoutMs: 60000,
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => app.close());
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(`${address}/v1/projects/codexly/acp/codex/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: {} }),
  });
  expect(response.status, await response.text()).toBe(200);
  expect(previewConfig).toHaveBeenCalledOnce();
});

it.each([0, 60000])(
  "HTTP 断连取消模型预览且正常正文结束不取消，handlerTimeout=%s",
  async (handlerTimeoutMs) => {
    const observed = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<undefined>();
    const previewConfig = vi.fn(
      async (_cwd: string, _input: AcpConfigPreviewRequest, signal?: AbortSignal) => {
        if (!signal) throw new Error("预览缺少取消信号");
        observed.resolve(signal);
        await release.promise;
        signal.throwIfAborted();
        return { configOptions: [], values: {} };
      },
    );
    const service = {
      inspect: vi.fn(),
      readDefaults: vi.fn(),
      updateDefaults: vi.fn(),
      setDefaultConfig: vi.fn(),
      authenticate: vi.fn(),
      previewConfig,
    };
    const app = await createCodexlyServer({
      ...createServerOptions(createProvider().provider),
      handlerTimeoutMs,
      acpAgents: { codex: service, claude: service },
    });
    closeCallbacks.push(() => app.close());
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    // 普通聊天也必须走相同的授权与取消边界。
    const response = fetch(`${address}/v1/temporary/acp/claude/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: {} }),
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      const signal = await observed.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(signal.aborted).toBe(false);
      controller.abort();
      await response;
      await vi.waitFor(() => {
        expect(signal.aborted).toBe(true);
      });
    } finally {
      controller.abort();
      release.resolve(undefined);
      await response;
    }
  },
);

it("预览超时返回有效可重试的提供商错误", async () => {
  const previewConfig = vi.fn(
    async (_cwd: string, _input: AcpConfigPreviewRequest, signal?: AbortSignal) => {
      if (!signal) throw new Error("预览缺少取消信号");
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
      signal.throwIfAborted();
      return { configOptions: [], values: {} };
    },
  );
  const service = {
    inspect: vi.fn(),
    readDefaults: vi.fn(),
    updateDefaults: vi.fn(),
    setDefaultConfig: vi.fn(),
    authenticate: vi.fn(),
    previewConfig,
  };
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    handlerTimeoutMs: 200,
    acpAgents: { codex: service, claude: service },
  });
  closeCallbacks.push(() => app.close());
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(`${address}/v1/projects/codexly/acp/codex/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: {} }),
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
});
