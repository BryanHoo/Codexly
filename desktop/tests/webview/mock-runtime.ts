import { browser } from "@wdio/globals";

import { waitForWebviewBridge } from "./bridge-readiness.mjs";
import {
  approvalRequest,
  connectedProvider,
  disconnectedProvider,
  gitStatus,
  modelPage,
  projectDefaults,
  projects,
  settings,
  tasks,
} from "./fixtures.js";

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
        () => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ !== undefined
          && window.__CODEAGENT_WEBVIEW_TEST_READY__ !== true,
      );
      if (!ready) throw new Error("Fresh WebView test bridge is unavailable");
    });
  }

  await browser.execute(
    (fixtures) => {
      const bridge = window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__;
      if (bridge === undefined) throw new Error("WebView test bridge is unavailable");
      Object.assign(bridge.defaults, fixtures.defaults);
      bridge.once.get_provider_connection = [fixtures.disconnectedProvider];
      bridge.handlers.list_tasks = (args) => {
        const input = args.input as { projectId?: string } | undefined;
        return {
          data: fixtures.tasks.filter((task) => task.projectId === input?.projectId),
          nextCursor: null,
        };
      };
    },
    {
      disconnectedProvider,
      tasks,
      defaults: {
        add_queued_submission: { queuedSubmission },
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
          codexVersion: "0.156.0",
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
          detectedVersion: "0.156.0",
          requiredVersion: "0.156.0",
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
