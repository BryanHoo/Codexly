import type { AgentProvider, AgentRuntimeProvider } from "@codexly/core";
import type {
  AgentProviderConnectionStatus,
  ConfigureCustomProviderResponse,
} from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  temporaryProject,
  turnOptions,
  turnRequest,
  task,
  snapshot,
  closeCallbacks,
  createProvider,
  createSettingsRepository,
  createRuntimeConnectionMethods,
  createServerOptions,
} from "./app-all.test-support.js";

describe("server diagnostics and provider connection", () => {
  it("only emits redacted warning and error logs", async () => {
    const { provider } = createProvider();
    const slowProvider = {
      ...provider,
      listTasks: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const logLines: string[] = [];
    const app = await createCodexlyServer(
      createServerOptions(slowProvider, {
        handlerTimeoutMs: 10,
        loggerEnabled: true,
        logDestination: {
          write(message: string) {
            logLines.push(message);
          },
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      headers: {
        authorization: "Bearer secret-token",
        cookie: "session=secret-cookie",
        "x-api-key": "secret-api-key",
      },
      method: "GET",
      url: "/v1/health",
    });
    const timedOutResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks",
    });

    expect(response.statusCode).toBe(200);
    expect(timedOutResponse.statusCode).toBe(503);
    const logs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const timeoutLog = logs.find((entry) => entry["statusCode"] === 503);
    expect(timeoutLog).toMatchObject({
      level: 50,
      method: "GET",
      msg: "request completed",
      statusCode: 503,
    });
    expect(typeof timeoutLog?.["durationMs"]).toBe("number");
    expect(typeof timeoutLog?.["requestId"]).toBe("string");
    expect(logs.every((entry) => Number(entry["level"]) >= 40)).toBe(true);
    expect(logs.some((entry) => entry["route"] === "/v1/health")).toBe(false);
    expect(logLines.join("\n")).not.toContain("secret-token");
    expect(logLines.join("\n")).not.toContain("secret-cookie");
    expect(logLines.join("\n")).not.toContain("secret-api-key");
  });

  it("switches provider modes without persisting the custom API key", async () => {
    const providerHarness = createProvider();
    const state = createSettingsRepository();
    const customModels: ConfigureCustomProviderResponse["models"] = {
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "custom-model",
          id: "custom-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const customStatus: AgentProviderConnectionStatus = {
      account: { type: "apiKey" as const },
      customBaseUrl: "https://api.example.com/v1",
      mode: "custom" as const,
      pendingLogin: null,
      state: "connected" as const,
    };
    const configureCustomProvider = vi.fn(() =>
      Promise.resolve({ models: customModels, status: customStatus }),
    );
    const cancelProviderLogin = vi.fn(() =>
      Promise.resolve({
        status: { ...customStatus, pendingLogin: null, state: "connected" as const },
      }),
    );
    const startOfficialProviderLogin = vi.fn(() =>
      Promise.resolve({
        authUrl: "https://auth.openai.com/authorize",
        loginId: "login-1",
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: { error: null, loginId: "login-1", state: "pending" as const },
          state: "pending" as const,
        },
      }),
    );
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      cancelProviderLogin,
      configureCustomProvider,
      forProject: () => providerHarness.provider,
      forTemporary: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      readProviderConnection: vi.fn(() => Promise.resolve(customStatus)),
      releaseProject: () => Promise.resolve(),
      startOfficialProviderLogin,
    };
    const app = await createCodexlyServer(
      createServerOptions(providerHarness.provider, {
        provider: runtimeProvider,
        providerConnectionRepository: state.repository,
        settingsRepository: state.repository,
      }),
    );
    closeCallbacks.push(() => app.close());

    const customResponse = await app.inject({
      headers: { "idempotency-key": "custom-provider" },
      method: "PUT",
      payload: { apiKey: "custom-secret", baseUrl: "https://api.example.com/v1" },
      url: "/v1/provider-connection/custom",
    });
    const modelsResponse = await app.inject({ method: "GET", url: "/v1/models" });
    configureCustomProvider.mockRejectedValueOnce(new Error("custom endpoint unavailable"));
    const failedCustomResponse = await app.inject({
      headers: { "idempotency-key": "failed-custom-provider" },
      method: "PUT",
      payload: { apiKey: "another-secret", baseUrl: "https://invalid.example.com/v1" },
      url: "/v1/provider-connection/custom",
    });
    const officialResponse = await app.inject({
      headers: { "idempotency-key": "official-login" },
      method: "POST",
      payload: {},
      url: "/v1/provider-connection/official-login",
    });
    const repeatedOfficialResponse = await app.inject({
      headers: { "idempotency-key": "official-login" },
      method: "POST",
      payload: {},
      url: "/v1/provider-connection/official-login",
    });
    const cancelResponse = await app.inject({
      headers: { "idempotency-key": "cancel-login" },
      method: "POST",
      payload: { loginId: "login-1" },
      url: "/v1/provider-connection/official-login/cancel",
    });

    expect(customResponse.statusCode, customResponse.body).toBe(200);
    expect(modelsResponse.json()).toEqual(customModels);
    expect(failedCustomResponse.statusCode).toBe(502);
    // 自定义失败不覆盖旧目录；第二次写入来自随后成功切换的官方模式。
    expect(state.writeProviderConnection).toHaveBeenCalledTimes(2);
    expect(configureCustomProvider).toHaveBeenCalledWith({
      apiKey: "custom-secret",
      baseUrl: "https://api.example.com/v1",
    });
    expect(JSON.stringify(state.writeProviderConnection.mock.calls)).not.toContain("custom-secret");
    expect(officialResponse.statusCode, officialResponse.body).toBe(200);
    expect(repeatedOfficialResponse.json()).toEqual(officialResponse.json());
    expect(cancelResponse.statusCode, cancelResponse.body).toBe(200);
    expect(startOfficialProviderLogin).toHaveBeenCalledOnce();
    expect(cancelProviderLogin).toHaveBeenCalledWith("login-1");
  });

  it("serves temporary conversations without exposing the internal Project", async () => {
    const providerHarness = createProvider();
    const temporaryTask = { ...task, projectId: temporaryProject.id, title: "临时任务" };
    const temporarySnapshot = { ...snapshot, ...temporaryTask };
    const startTemporaryTask = vi.fn(() => Promise.resolve(temporaryTask));
    const temporaryProvider: AgentProvider = {
      ...providerHarness.provider,
      listTasks: vi.fn(() => Promise.resolve({ data: [temporaryTask], nextCursor: null })),
      readTask: vi.fn(() => Promise.resolve(temporarySnapshot)),
      startTask: startTemporaryTask,
    };
    const settings = createSettingsRepository();
    const app = await createCodexlyServer(
      createServerOptions(temporaryProvider, { settingsRepository: settings.repository }),
    );
    closeCallbacks.push(() => app.close());

    const listed = await app.inject({ method: "GET", url: "/v1/temporary/tasks?limit=25" });
    const created = await app.inject({
      headers: { "idempotency-key": "temporary-task" },
      method: "POST",
      payload: {},
      url: "/v1/temporary/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "temporary-turn" },
      method: "POST",
      payload: turnRequest("解释这段代码"),
      url: "/v1/temporary/tasks/task-1/turns",
    });
    const settingsUpdate = await app.inject({
      headers: { "idempotency-key": "temporary-settings" },
      method: "PUT",
      payload: turnOptions,
      url: "/v1/temporary/tasks/task-1/settings",
    });
    const internalProject = await app.inject({
      method: "GET",
      url: "/v1/projects/temporary/tasks",
    });
    const projectTool = await app.inject({ method: "GET", url: "/v1/temporary/git/status" });
    const skills = await app.inject({ method: "GET", url: "/v1/temporary/skills" });

    expect(listed.statusCode).toBe(200);
    expect(created.statusCode).toBe(201);
    expect(turn.statusCode).toBe(201);
    expect(settingsUpdate.statusCode).toBe(200);
    expect(internalProject.statusCode).toBe(404);
    expect(projectTool.statusCode).toBe(404);
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toMatchObject({ data: [{ name: "review-security" }] });
    expect(startTemporaryTask).toHaveBeenCalledWith();
    const temporaryTurnOptions = turnOptions;
    expect(settingsUpdate.json()).toEqual({ settings: temporaryTurnOptions });
    expect(settings.writeTaskSettings).toHaveBeenNthCalledWith(
      1,
      temporaryProject.id,
      temporaryTask.id,
      temporaryTurnOptions,
    );
    expect(settings.writeTaskSettings).toHaveBeenLastCalledWith(
      temporaryProject.id,
      temporaryTask.id,
      temporaryTurnOptions,
    );
    expect(providerHarness.startTurn).toHaveBeenCalledWith(
      temporaryTask.id,
      expect.any(Object),
      temporaryTurnOptions,
    );
  });
});
