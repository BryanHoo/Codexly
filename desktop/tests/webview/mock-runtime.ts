import { browser } from "@wdio/globals";

import { waitForWebviewBridge } from "./bridge-readiness.mjs";
import {
  approvalRequest,
  connectedProvider,
  gitStatus,
  modelPage,
  projectDefaults,
  projects,
  settings,
  tasks,
} from "./fixtures.js";

// WebView 夹具只提供关于页使用的版本显示样本。
const FIXTURE_AGENT_VERSION = "0.166.0";

type CommandMock = Readonly<{
  mockResolvedValue: (value: unknown) => Promise<void>;
}>;

export type WebviewMocks = Readonly<{
  listQueue: CommandMock;
  readTask: CommandMock;
}>;

function commandMock(command: string): CommandMock {
  return {
    mockResolvedValue: async (value) => {
      await browser.execute(
        (input) => {
          const bridge = window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__;
          if (bridge === undefined) throw new Error("WebView test bridge is unavailable");
          bridge.defaults[input.command] = input.value;
        },
        { command, value },
      );
    },
  };
}

export async function installWebviewMocks(): Promise<WebviewMocks> {
  const queuedSubmission = {
    attachments: [],
    clientUserMessageId: "queue-client-1",
    id: "queue-1",
    skills: [],
    status: "queued",
    text: "排队补充测试",
  };
  // macOS WKWebView 可能先建立会话，再异步完成底层执行通道和应用测试桥接。
  await waitForWebviewBridge(async () => {
    const ready = await browser.execute(
      () => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ !== undefined,
    );
    if (!ready) throw new Error("WebView test bridge is unavailable");
  });

  // Embedded runners reuse the application across spec files. Reload a started
  // WebView so its stores and startup queries consume this spec's fresh fixtures.
  if (await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_READY__ === true)) {
    await browser.refresh();
    await waitForWebviewBridge(async () => {
      const ready = await browser.execute(
        () =>
          window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ !== undefined &&
          window.__CODEAGENT_WEBVIEW_TEST_READY__ !== true,
      );
      if (!ready) throw new Error("Fresh WebView test bridge is unavailable");
    });
  }

  await browser.execute(
    (fixtures) => {
      const bridge = window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__;
      if (bridge === undefined) throw new Error("WebView test bridge is unavailable");
      Object.assign(bridge.defaults, fixtures.defaults);
      const session = { configOptions: [], availableCommands: [] };
      bridge.handlers.acp_task_request = (args) => {
        const { method } = args as { method: string };
        // 软件走真实 ACP 请求路由，旧快照样本在夹具边界附上当前会话身份。
        switch (method) {
          case "task.read": {
            const response = bridge.defaults.read_task as
              | { checkpoint: unknown; snapshot: Record<string, unknown> }
              | null;
            return response === null
              ? null
              : { ...response, snapshot: { ...response.snapshot, acpSession: session,
                  engine: "codex", runtime: "acp", writeAccess: "writable" } };
          }
          case "task.retain":
          case "task.release":
            return null;
          case "queue.list":
            return bridge.defaults.list_queued_submissions;
          case "queue.add":
            return bridge.defaults.add_queued_submission;
          case "session.config.read":
            return [];
          case "session.state.read":
            return session;
          default:
            throw new Error(`Missing ACP task fixture for ${method}`);
        }
      };
      const model = {
        category: "model", id: "model", name: "模型", type: "select",
        currentValue: "gpt-5.6-sol", options: [{ value: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
      };
      let baseUrl = fixtures.connectedProvider.customBaseUrl as string;
      const providers = () => ({
        providers: [{
          providerId: "openai", supported: ["openai"], required: false,
          current: { apiType: "openai", baseUrl },
        }],
        restartRequired: false,
      });
      bridge.handlers.acp_agent_request = (args) => {
        const { method, params } = args as { method: string; params: { config?: { baseUrl?: string } } };
        switch (method) {
          case "agents.list":
            return { agents: [{
              detected: true, enabled: true, engine: "codex", environmentKeys: [],
              installed: true, name: "Codex", description: "",
            }] };
          case "agents.progress":
            return { operations: [] };
          case "agent.inspect":
            return { engine: "codex", protocolVersion: 2, providerConfiguration: true, authMethods: [],
              connection: { source: "native", baseUrl, apiType: "openai", hasCredentials: true } };
          case "providers.set":
            baseUrl = params.config?.baseUrl ?? baseUrl;
            return providers();
          case "providers.list":
            return providers();
          case "settings.read":
            return { configOptions: [model], defaults: { model: model.currentValue }, unmappedLegacy: [], invalidDefaults: [] };
          case "settings.preview":
            return { configOptions: [model], values: { model: model.currentValue } };
          default:
            throw new Error(`Missing ACP agent fixture for ${method}`);
        }
      };
      bridge.handlers.list_tasks = (args) => {
        const input = args.input as { projectId?: string } | undefined;
        return {
          data: fixtures.tasks.filter((task) => task.projectId === input?.projectId),
          nextCursor: null,
        };
      };
    },
    {
      connectedProvider,
      tasks,
      defaults: {
        add_queued_submission: { queuedSubmission },
        application_preferences_request: {
          defaultAgent: "codex", defaultModel: null, commitMessagePrompt: "", taskTitlePrompt: "",
          promptOptimizationPrompt: "", defaultOpenAppId: null, followUpBehavior: "queue",
          pet: { enabled: false, selectedPetId: null },
        },
        cancel_native_request: null,
        commit_project_changes: {
          branch: "test/webview",
          commitSha: "b".repeat(40),
          message: "test(webview): 覆盖原生流程",
          pushError: null,
          pushStatus: "not_requested",
          indexSyncError: null,
        },
        configure_custom_provider: { models: modelPage, status: connectedProvider },
        connect_runtime: { lastSeq: 0, provider: "codex", status: "ready" },
        delete_queued_submission: { deleted: true },
        generate_commit_message: {
          message: "test(webview): 覆盖原生流程",
          snapshot: gitStatus.snapshot,
        },
        get_app_info: {
          appVersion: "0.1.0",
          changelogUrl: "https://github.com/BryanHoo/Codexly/blob/main/desktop/CHANGELOG.md",
          codexVersion: FIXTURE_AGENT_VERSION,
          latestVersion: null,
          releaseNotes: "## [0.1.0] - 2026-08-31",
          releaseNotesVersion: "0.1.0",
          repositoryUrl: "https://github.com/BryanHoo/Codexly",
          status: "current",
          updateAvailable: false,
        },
        get_global_settings: { settings },
        get_project_defaults: { settings: projectDefaults },
        get_project_git_status: gitStatus,
        get_project_open_capabilities: {
          apps: [],
          platform: process.platform === "win32" ? "win32" : process.platform,
        },
        get_provider_connection: connectedProvider,
        initialize_app_storage: {
          "codeagent.language-preference": JSON.stringify({ language: "zh-CN", version: 1 }),
        },
        inspect_codex_runtime: {
          detectedVersion: FIXTURE_AGENT_VERSION,
          requiredVersion: FIXTURE_AGENT_VERSION,
          status: "compatible",
        },
        list_background_terminals: { data: [] },
        list_mcp_servers: { data: [] },
        list_models: modelPage,
        list_project_files: { entries: [], path: null },
        list_projects: { data: projects, nextCursor: null },
        list_queued_submissions: { data: [], nextCursor: null },
        list_skills: { data: [], nextCursor: null },
        list_workbench_pets: { data: [] },
        read_task: null,
        release_task_subscription: null,
        reorder_queued_submissions: { status: "reordered" },
        retain_task_subscription: null,
        resolve_pending_request: {
          request: { ...approvalRequest, status: "resolved" },
        },
        start_runtime: { lastSeq: 0, provider: "codex", status: "ready" },
        sync_desktop_pet: null,
        update_queued_submission: { queuedSubmission },
      },
    },
  );

  return {
    listQueue: commandMock("list_queued_submissions"),
    readTask: commandMock("read_task"),
  };
}

export async function releaseApplicationStartup(): Promise<void> {
  await browser.execute(() => {
    window.__CODEAGENT_WEBVIEW_TEST_READY__ = true;
  });
}

export async function connectMockProvider(apiKey?: string): Promise<void> {
  const settings = await $("aria/设置");
  await settings.waitForClickable();
  if (apiKey === undefined) return;
  await settings.click();
  await $('button=ACP').click();
  const address = await $('[role="dialog"] input[type="url"]');
  await address.waitForDisplayed();
  await address.setValue("https://gateway-updated.test/v1");
  await $('[role="dialog"] input[type="password"]').setValue(apiKey);
  await $("aria/保存连接").click();
  await browser.waitUntil(async () => browser.execute(() => {
    const calls = window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls.acp_agent_request ?? [];
    return calls.some((call) => (call as { method?: string }).method === "providers.set");
  }));
  await $('[role="dialog"][data-slot="dialog-content"]').$("aria/关闭").click();
  await settings.waitForClickable();
}

export async function passthroughNativeCommands(commands: readonly string[]): Promise<void> {
  await browser.execute((commandNames) => {
    const bridge = window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__;
    if (bridge === undefined) throw new Error("WebView test bridge is unavailable");
    for (const command of commandNames) bridge.passthrough.add(command);
  }, commands);
}

export async function emitAgentEvent(event: Record<string, unknown>): Promise<void> {
  await browser.execute((payload) => {
    const channel = window.__CODEAGENT_RUNTIME_CHANNEL__;
    if (channel === undefined) throw new Error("Runtime channel is not connected");
    channel.onmessage({ data: { event: payload }, type: "agentEvent" });
  }, event);
}
