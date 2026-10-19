import type { AgentProviderTaskSnapshot } from "@codexly/core";
import { DEFAULT_CLAUDE_SETTINGS, type AgentTaskSettings } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  modelPage,
  snapshot,
  closeCallbacks,
  createProvider,
  createSettingsRepository,
  createServerOptions,
  createHarness,
} from "./app-all.test-support.js";

describe("server task settings", () => {
  it("reads task settings after ownership is confirmed without overriding provider metadata", async () => {
    const { app, readTask, readTaskSettings } = await createHarness();
    let resolveTask!: (value: AgentProviderTaskSnapshot) => void;
    let resolveSettings!: (value: AgentTaskSettings | undefined) => void;
    readTask.mockImplementationOnce(
      () =>
        new Promise<AgentProviderTaskSnapshot>((resolve) => {
          resolveTask = resolve;
        }),
    );
    readTaskSettings.mockImplementationOnce(
      () =>
        new Promise<AgentTaskSettings | undefined>((resolve) => {
          resolveSettings = resolve;
        }),
    );

    const response = app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1",
    });
    await vi.waitFor(() => {
      expect(readTask).toHaveBeenCalledOnce();
    });
    expect(readTaskSettings).not.toHaveBeenCalled();

    resolveTask({
      ...snapshot,
      pinned: true,
      threadConfiguration: { model: "cli-model", reasoningEffort: "high" },
    });
    await vi.waitFor(() => {
      expect(readTaskSettings).toHaveBeenCalledOnce();
    });
    resolveSettings(undefined);

    expect((await response).json()).toMatchObject({
      snapshot: {
        pinned: true,
        threadConfiguration: { model: "cli-model", reasoningEffort: "high" },
      },
    });
  });

  it("returns effective settings and atomically validates complete updates", async () => {
    const {
      app,
      listModels,
      readProjectDefaults,
      readTaskSettings,
      writeProjectDefaults,
      writeTaskSettings,
    } = await createHarness();
    listModels.mockResolvedValue({
      data: [
        {
          defaultReasoningEffort: "high",
          description: "默认模型",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "低", id: "low" },
            { description: "高", id: "high" },
          ],
        },
      ],
      nextCursor: null,
    });
    readProjectDefaults.mockResolvedValue({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      fastMode: true,
      model: "removed-model",
      reasoningEffort: "ultra",
      sandboxMode: "read-only",
    });
    readTaskSettings.mockResolvedValue({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "removed-model",
      reasoningEffort: "ultra",
      sandboxMode: "danger-full-access",
    });

    const defaults = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/defaults",
    });
    const taskSnapshot = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1",
    });
    const invalid = await app.inject({
      headers: { "idempotency-key": "invalid-defaults" },
      method: "PUT",
      payload: {
        model: "gpt-5.6-sol",
        reasoningEffort: "ultra",
        sandboxMode: "workspace-write",
      },
      url: "/v1/projects/codexly/defaults",
    });
    const updated = await app.inject({
      headers: { "idempotency-key": "task-settings" },
      method: "PUT",
      payload: {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        model: "gpt-5.6-sol",
        reasoningEffort: "low",
        sandboxMode: "workspace-write",
      },
      url: "/v1/projects/codexly/tasks/task-1/settings",
    });

    expect(defaults.json()).toEqual({
      settings: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        fastMode: true,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "read-only",
      },
    });
    expect(taskSnapshot.json()).toMatchObject({
      snapshot: {
        settings: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "danger-full-access",
        },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(updated.json()).toEqual({
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        model: "gpt-5.6-sol",
        reasoningEffort: "low",
        sandboxMode: "workspace-write",
      },
    });
    expect(writeProjectDefaults).not.toHaveBeenCalledWith("codexly", {
      model: "gpt-5.6-sol",
      pet: { enabled: true as const, selectedPetId: "codex" },
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    expect(writeTaskSettings).not.toHaveBeenCalledWith("codexly", "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
  });

  it("uses global settings only when project and task settings are absent", async () => {
    const {
      app,
      readDefaultSettings,
      readGlobalSettings,
      readProjectDefaults,
      readTaskSettings,
      writeGlobalSettings,
      writeProjectDefaults,
      writeTaskSettings,
    } = await createHarness();
    const granularApprovalPolicy = {
      granular: {
        mcp_elicitations: false,
        request_permissions: true,
        rules: false,
        sandbox_approval: true,
        skill_approval: false,
      },
    } as const;
    const globalSettings = {
      approvalPolicy: granularApprovalPolicy,
      approvalsReviewer: "auto_review" as const,
      defaultAgent: "codex" as const,
      defaultModel: "gpt-5.6-sol",
      commitMessagePrompt: "",
      modelContextWindow: null,
      defaultOpenAppId: "visual-studio-code" as const,
      fastMode: true,
      followUpBehavior: "steer" as const,
      model: "gpt-5.6-sol",
      pet: { enabled: true as const, selectedPetId: "codex" },
      reasoningEffort: "high",
      sandboxMode: "danger-full-access" as const,
    };
    readGlobalSettings.mockResolvedValue(globalSettings);
    readProjectDefaults.mockResolvedValue(undefined);
    readTaskSettings.mockResolvedValue(undefined);

    const globalResponse = await app.inject({ method: "GET", url: "/v1/settings" });
    const projectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/defaults",
    });
    const taskResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1",
    });
    const updatedResponse = await app.inject({
      headers: { "idempotency-key": "global-settings" },
      method: "PUT",
      payload: globalSettings,
      url: "/v1/settings",
    });

    expect(globalResponse.json()).toEqual({ settings: globalSettings });
    expect(projectResponse.json()).toEqual({
      settings: {
        approvalPolicy: granularApprovalPolicy,
        approvalsReviewer: "auto_review",
        fastMode: true,
        model: globalSettings.model,
        reasoningEffort: globalSettings.reasoningEffort,
        sandboxMode: globalSettings.sandboxMode,
      },
    });
    expect(taskResponse.json()).toMatchObject({
      snapshot: {
        settings: {
          approvalPolicy: granularApprovalPolicy,
          approvalsReviewer: "auto_review",
          model: globalSettings.model,
          reasoningEffort: globalSettings.reasoningEffort,
          sandboxMode: globalSettings.sandboxMode,
        },
      },
    });
    expect(updatedResponse.json()).toEqual({ settings: globalSettings });
    expect(writeGlobalSettings).toHaveBeenCalledWith(globalSettings);
    expect(readDefaultSettings).toHaveBeenCalled();
    expect(writeProjectDefaults).not.toHaveBeenCalled();
    expect(writeTaskSettings).not.toHaveBeenCalled();
  });

  it("uses Codex user settings without persisting a snapshot on read", async () => {
    const { listModels, provider } = createProvider();
    listModels.mockResolvedValue({
      data: [
        ...modelPage.data.map((model) => ({ ...model, isDefault: false })),
        {
          defaultReasoningEffort: "low",
          description: "快速生成提交信息",
          displayName: "GPT-6 Luna",
          id: "gpt-6-luna",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "低", id: "low" }],
        },
        {
          defaultReasoningEffort: "medium",
          description: "用户模型",
          displayName: "GPT-5.6 Terra",
          id: "gpt-5.6-terra",
          isDefault: true,
          supportedReasoningEfforts: [
            { description: "中", id: "medium" },
            { description: "高", id: "high" },
          ],
        },
      ],
      nextCursor: null,
    });
    const settings = createSettingsRepository();
    const serverOptions = createServerOptions(provider, {
      settingsRepository: settings.repository,
    });
    const readDefaultSettings = vi.fn(() =>
      Promise.resolve({
        approvalPolicy: "never" as const,
        approvalsReviewer: "user" as const,
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        sandboxMode: "danger-full-access" as const,
      }),
    );
    const app = await createCodexlyServer({
      ...serverOptions,
      provider: { ...serverOptions.provider, readDefaultSettings },
    });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/settings" });

    expect(response.json()).toEqual({
      settings: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        defaultAgent: "codex" as const,
        defaultModel: "gpt-6-luna",
        commitMessagePrompt: "",
        modelContextWindow: null,
        defaultOpenAppId: null,
        fastMode: false,
        followUpBehavior: "queue",
        model: "gpt-5.6-terra",
        pet: { enabled: false, selectedPetId: null },
        reasoningEffort: "high",
        sandboxMode: "danger-full-access",
      },
    });
    expect(readDefaultSettings).toHaveBeenCalledOnce();
    expect(settings.writeGlobalSettings).not.toHaveBeenCalled();
  });

  it("fills missing Codex user settings from project defaults", async () => {
    const { provider } = createProvider();
    const settings = createSettingsRepository();
    const serverOptions = createServerOptions(provider, {
      settingsRepository: settings.repository,
    });
    const readDefaultSettings = vi.fn(() => Promise.resolve({ approvalPolicy: "never" as const }));
    const app = await createCodexlyServer({
      ...serverOptions,
      provider: { ...serverOptions.provider, readDefaultSettings },
    });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/settings" });

    expect(response.json()).toMatchObject({
      settings: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
    });
    expect(readDefaultSettings).toHaveBeenCalledOnce();
  });
});

it.each(["settings", "settings-and-defaults"])(
  "waits for Claude runtime permission confirmation before saving %s and preserves storage on rejection",
  async (route) => {
    const { provider, readTask } = createProvider();
    readTask.mockResolvedValue({ ...snapshot, engine: "claude" });
    const gate = Promise.withResolvers<undefined>();
    const updateTaskPermissionMode = vi.fn(() => gate.promise);
    provider.updateTaskPermissionMode = updateTaskPermissionMode;
    const settings = createSettingsRepository();
    const base = createServerOptions(provider, { settingsRepository: settings.repository });
    const profile = {
      engine: "claude" as const,
      capabilities: await provider.getCapabilities(),
      models: { ...modelPage, data: [...modelPage.data] },
      commands: [],
      connection: {
        state: "connected" as const,
        mode: "custom" as const,
        account: null,
        customBaseUrl: null,
        pendingLogin: null,
      },
    };
    const app = await createCodexlyServer({
      ...base,
      provider: {
        ...base.provider,
        engines: {
          claude: {
            inspect: () => Promise.resolve(profile),
            readSettings: () => Promise.resolve(DEFAULT_CLAUDE_SETTINGS),
            writeSettings: (value) => Promise.resolve(value),
            configure: () =>
              Promise.resolve({ status: profile.connection, models: profile.models }),
            disconnect: () => Promise.resolve({ status: profile.connection }),
          },
        },
      },
    });
    closeCallbacks.push(() => app.close());
    const next: AgentTaskSettings = {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxMode: "workspace-write",
      engineOptions: { engine: "claude", permissionMode: "plan" },
    };
    const pending = app.inject({
      method: "PUT",
      url: `/v1/projects/codexly/tasks/task-1/${route}`,
      headers: { "idempotency-key": "live-claude-plan" },
      payload: route === "settings" ? next : { settings: next, fastMode: false },
    });
    // Fastify inject 是惰性 thenable；提前启动请求，才能观察原生确认之前的存储边界。
    const response = Promise.resolve(pending);
    await vi.waitFor(() => {
      expect(updateTaskPermissionMode).toHaveBeenCalledWith("task-1", "plan");
    });
    expect(settings.writeTaskSettings).not.toHaveBeenCalled();
    gate.resolve(undefined);
    expect((await response).statusCode).toBe(200);
    expect(settings.writeTaskSettings).toHaveBeenCalledOnce();
    updateTaskPermissionMode.mockRejectedValueOnce(new Error("mode rejected"));
    const rejected = await app.inject({
      method: "PUT",
      url: `/v1/projects/codexly/tasks/task-1/${route}`,
      headers: { "idempotency-key": "live-claude-denied" },
      payload:
        route === "settings"
          ? { ...next, engineOptions: { engine: "claude", permissionMode: "bypassPermissions" } }
          : {
              settings: {
                ...next,
                engineOptions: { engine: "claude", permissionMode: "bypassPermissions" },
              },
              fastMode: false,
            },
    });
    expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
    expect(settings.writeTaskSettings).toHaveBeenCalledOnce();
  },
);
