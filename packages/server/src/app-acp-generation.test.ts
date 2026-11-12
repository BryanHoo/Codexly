import { expect, it, vi } from "vitest";
import { ApplicationPreferencesService } from "@codexly/core";
import type { ProjectGitStatus } from "@codexly/protocol";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  createSettingsRepository,
  projectRootPath,
  encodedProjectRootPath,
} from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("生产 HTTP 生成读取私有偏好，保留 Git 快照和幂等，完全绕开旧 SDK", async () => {
  const store = await openRepository(await createWorkspace());
  await new ApplicationPreferencesService(store, () => Promise.resolve(undefined)).patch({
    defaultAgent: "claude",
    defaultModel: null,
    promptOptimizationPrompt: "私有优化规则",
    commitMessagePrompt: "私有提交规则",
  });
  const h = createProvider(),
    settings = createSettingsRepository(),
    options = createServerOptions(h.provider);
  const source = settings.readGlobalSettings.mockRejectedValue(new Error("旧仓储不可读"));
  const generateText = vi
    .fn()
    .mockResolvedValueOnce('{"message":"优化后的请求"}')
    .mockResolvedValueOnce('{"message":"feat(acp): 修复生成"}');
  options.provider = {
    ...options.provider,
    getCapabilities: async () => ({ ...(await h.provider.getCapabilities()), runtime: "acp" }),
    generateText,
  };
  const snapshot = "a".repeat(64);
  const status: ProjectGitStatus = {
    branch: "main",
    branches: ["main"],
    baseBranches: ["main"],
    repositoryMode: "root",
    snapshot,
    staged: [],
    unstaged: [{ path: "src/app.ts", kind: "update", diff: "-old\n+new" }],
  };
  const app = await createCodexlyServer({
    ...options,
    localCatalogStore: store,
    settingsRepository: settings.repository,
    readProjectGitStatus: () => Promise.resolve(status),
  });
  closeCallbacks.push(() => app.close());
  const optimize = {
    method: "POST" as const,
    url: "/v1/projects/codexly/prompt-optimization",
    headers: { "idempotency-key": "acp-optimize" },
    payload: { text: "修复登录" },
  };
  const response = await app.inject(optimize);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toEqual({ text: "优化后的请求" });
  expect((await app.inject(optimize)).json()).toEqual(response.json());
  const commit = await app.inject({
    method: "POST",
    url: `/v1/projects/codexly/git/commit-message?rootPath=${encodedProjectRootPath}`,
    headers: { "idempotency-key": "acp-commit" },
    payload: { engine: "codex", expectedSnapshot: snapshot, paths: ["src/app.ts"] },
  });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(commit.json()).toEqual({ message: "feat(acp): 修复生成", snapshot });
  expect(generateText).toHaveBeenCalledTimes(2);
  for (const call of generateText.mock.calls) {
    expect(call[0]).toBe("claude");
    expect(call[1]).toBe(projectRootPath);
    expect(call[3]).toBeUndefined();
  }
  expect(generateText.mock.calls[0]?.[2]).toContain("私有优化规则");
  expect(generateText.mock.calls[1]?.[2]).toContain("私有提交规则");
  expect(generateText.mock.calls[1]?.[2]).toContain("-old\n+new");
  expect(source).not.toHaveBeenCalled();
  expect(h.startTask).not.toHaveBeenCalled();
  expect(h.listModels).not.toHaveBeenCalled();
  generateText.mockResolvedValue("bad output");
  const bad = await app.inject({ ...optimize, headers: { "idempotency-key": "acp-bad-output" } });
  expect(bad.statusCode).toBe(502);
  expect(h.startTask).not.toHaveBeenCalled();
});

it.each(["catalog", "port", "preferences"] as const)(
  "ACP 缺少 %s 时明确失败，不调用旧生成器",
  async (missing) => {
    const store = await openRepository(await createWorkspace());
    const h = createProvider(),
      settings = createSettingsRepository(),
      options = createServerOptions(h.provider);
    settings.readGlobalSettings.mockRejectedValue(new Error("偏好不可读"));
    const generateText = vi.fn();
    const provider = {
      ...options.provider,
      getCapabilities: async () => ({
        ...(await h.provider.getCapabilities()),
        runtime: "acp" as const,
      }),
      ...(missing === "port" ? {} : { generateText }),
    };
    const app = await createCodexlyServer({
      ...options,
      provider,
      settingsRepository: settings.repository,
      ...(missing === "catalog" ? {} : { localCatalogStore: store }),
    });
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/codexly/prompt-optimization",
      headers: { "idempotency-key": "missing" },
      payload: { text: "input" },
    });
    expect(response.statusCode, response.body).toBe(missing === "preferences" ? 502 : 503);
    expect(generateText).not.toHaveBeenCalled();
    expect(h.startTask).not.toHaveBeenCalled();
    expect(h.listModels).not.toHaveBeenCalled();
  },
);
