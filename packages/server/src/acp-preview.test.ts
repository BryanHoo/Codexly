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
