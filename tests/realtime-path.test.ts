import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

import { CodeAgentClient } from "@code-agent/client";
import type {
  AgentEvent,
  AgentGlobalSettings,
  AgentProviderConnectionRecord,
  AgentProjectDefaults,
  AgentTaskSettings,
  PendingRequest,
} from "@code-agent/protocol";
import {
  CodexAppServerProcess,
  SUPPORTED_CODEX_VERSION,
  createCodexRuntimeProvider,
} from "@code-agent/provider-codex";
import { createCodeAgentServer } from "@code-agent/server";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";

const fakeAppServerPath = fileURLToPath(
  new URL("../packages/provider-codex/test/fixtures/fake-app-server.mjs", import.meta.url),
);

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
} as const;

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const turnOptions = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

const runtimes: CodexAppServerProcess[] = [];
const servers: Awaited<ReturnType<typeof createCodeAgentServer>>[] = [];

function createRealtimeClient(baseUrl: string): CodeAgentClient {
  const origin = new URL(baseUrl).origin;
  return new CodeAgentClient({
    baseUrl,
    // Node 集成测试显式模拟浏览器自动附带的同源 Origin。
    webSocketFactory: (url) => new NodeWebSocket(url, { origin }) as unknown as WebSocket,
  });
}

async function startFakeAppServer(scenario: string): Promise<CodexAppServerProcess> {
  // Fake Server 是 Node.js 脚本，Windows 必须通过原生 node.exe 启动。
  const child = spawn(process.execPath, [fakeAppServerPath, "app-server", "--listen", "stdio://"], {
    env: { ...process.env, FAKE_APP_SERVER_SCENARIO: scenario },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const runtime = new CodexAppServerProcess(
    child,
    { path: process.execPath, source: "explicit" },
    { raw: `codex-cli ${SUPPORTED_CODEX_VERSION}`, version: SUPPORTED_CODEX_VERSION },
    { rpcTimeoutMs: 1_000, shutdownTimeoutMs: 200 },
  );
  try {
    await runtime.waitForSpawn();
    await runtime.client.request("initialize", {
      capabilities: { experimentalApi: true },
      clientInfo: { name: "code_agent", title: "CodeAgent", version: "0.0.0" },
    });
    runtime.client.notify("initialized", {});
    runtimes.push(runtime);
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

function createServerOptions(provider: ReturnType<typeof createCodexRuntimeProvider>) {
  let globalSettings: AgentGlobalSettings | undefined;
  let providerConnection: AgentProviderConnectionRecord | undefined;
  const projectDefaults = new Map<string, AgentProjectDefaults>();
  const taskSettings = new Map<string, AgentTaskSettings>();

  const stateRepository = {
    readGlobalSettings: () => Promise.resolve(globalSettings),
    readProjectDefaults: (projectId: string) => Promise.resolve(projectDefaults.get(projectId)),
    readProviderConnection: () => Promise.resolve(providerConnection),
    readTaskSettings: (projectId: string, taskId: string) =>
      Promise.resolve(taskSettings.get(`${projectId}:${taskId}`)),
    writeGlobalSettings: (settings: AgentGlobalSettings) => {
      globalSettings = settings;
      return Promise.resolve(settings);
    },
    writeProjectDefaults: (projectId: string, settings: AgentProjectDefaults) => {
      projectDefaults.set(projectId, settings);
      return Promise.resolve(settings);
    },
    writeProviderConnection: (record: AgentProviderConnectionRecord) => {
      providerConnection = record;
      return Promise.resolve(record);
    },
    writeTaskSettings: (projectId: string, taskId: string, settings: AgentTaskSettings) => {
      taskSettings.set(`${projectId}:${taskId}`, settings);
      return Promise.resolve(settings);
    },
  };

  return {
    installAppUpdate: () => Promise.reject(new Error("No update available")),
    projectRepository: {
      list: () => Promise.resolve([project]),
      read: (projectId: string) => Promise.resolve(projectId === project.id ? project : undefined),
      register: () => Promise.resolve(project),
      remove: () => Promise.resolve(false),
      rename: () => Promise.resolve(undefined),
      reorder: () => Promise.resolve([project]),
    },
    providerConnectionRepository: stateRepository,
    provider,
    readAppInfo: () =>
      Promise.resolve({
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        latestVersion: "1.3.0",
        releaseNotes: null,
        status: "current" as const,
        updateAvailable: false,
      }),
    settingsRepository: stateRepository,
    temporaryWorkspace: "/workspace/temporary",
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  await Promise.all(runtimes.splice(0).map(async (runtime) => runtime.close()));
});

describe("Realtime Path", () => {
  it("delivers Fake App Server notifications through Provider and WebSocket", async () => {
    const runtime = await startFakeAppServer("realtime");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "integration-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = createRealtimeClient(baseUrl);
    const snapshot = await client.readTask(project.id, "task-realtime");
    const events: AgentEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for Fake App Server realtime events"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
        onError: reject,
        onEvent(event) {
          events.push(event);
          if (event.type === "provider.error") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "item.started",
      "message.delta",
      "message.delta",
      "item.completed",
      "command.output_delta",
      "item.completed",
      "item.completed",
      "usage.updated",
      "turn.completed",
      "provider.error",
    ]);
    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.payload.delta)
        .join(""),
    ).toBe("Realtime connected");
    expect(events.find((event) => event.type === "item.started")).toMatchObject({
      payload: {
        item: {
          input: { prompt: "理解前端项目" },
          name: "agent/spawn",
          status: "running",
          type: "tool",
        },
      },
    });
    expect(events.at(-1)).toMatchObject({
      payload: { message: "模型服务不可用", willRetry: false },
      type: "provider.error",
    });
  });

  it("submits a prompt and streams the completed turn through the full mutation path", async () => {
    const runtime = await startFakeAppServer("agent-actions");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "action-complete-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = createRealtimeClient(baseUrl);
    const models = await client.listModels();
    const created = await client.startTask(project.id, { idempotencyKey: "create-complete" });
    const uploaded = await client.uploadAttachment(
      project.id,
      {
        content: new Blob([Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64")], {
          type: "image/png",
        }),
        kind: "image",
        name: "screen.png",
      },
      { idempotencyKey: "upload-complete" },
    );
    const snapshot = await client.readTask(project.id, created.task.id);
    const events: AgentEvent[] = [];

    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for turn completion"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
        onError: reject,
        onEvent(event) {
          if (event.taskId !== created.task.id) {
            return;
          }
          events.push(event);
          if (event.type === "turn.completed") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    await client.startTurn(
      project.id,
      created.task.id,
      {
        attachments: [{ id: uploaded.attachment.id }],
        skills: [],
        text: "完成流式回复",
        type: "prompt",
      },
      turnOptions,
      { idempotencyKey: "turn-complete" },
    );
    await completed;

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "item.completed",
      "message.delta",
      "message.delta",
      "item.completed",
      "usage.updated",
      "turn.completed",
    ]);
    expect(events.filter((event) => event.type === "item.completed")).toMatchObject([
      { payload: { item: { role: "user", text: "完成流式回复", type: "message" } } },
      { payload: { item: { role: "assistant", text: "流式回复完成", type: "message" } } },
    ]);
    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.payload.delta)
        .join(""),
    ).toBe("流式回复完成");
    expect(models.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "gpt-5.6-sol", isDefault: true })]),
    );
    expect(events.at(-1)).toMatchObject({
      payload: { turn: { status: "completed" } },
      type: "turn.completed",
    });
  });

  it("resolves a session-scoped filesystem permission through the full mutation path", async () => {
    const runtime = await startFakeAppServer("agent-actions");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "permission-approval-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = createRealtimeClient(baseUrl);
    const created = await client.startTask(project.id, { idempotencyKey: "create-permission" });
    const snapshot = await client.readTask(project.id, created.task.id);
    const events: AgentEvent[] = [];

    let resolvePending!: (
      request: Extract<PendingRequest, { type: "permissions_approval" }>,
    ) => void;
    const pending = new Promise<Extract<PendingRequest, { type: "permissions_approval" }>>(
      (resolve) => {
        resolvePending = resolve;
      },
    );
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for permission approval lifecycle"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
        onError: reject,
        onEvent(event) {
          if (event.taskId !== created.task.id) return;
          events.push(event);
          if (
            event.type === "pending_request.created" &&
            event.payload.request.type === "permissions_approval"
          ) {
            resolvePending(event.payload.request);
          }
          if (event.type === "turn.completed") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    await client.startTurn(
      project.id,
      created.task.id,
      { attachments: [], skills: [], text: "审批权限", type: "prompt" },
      turnOptions,
      { idempotencyKey: "turn-permission" },
    );
    const request = await pending;
    await client.resolvePendingRequest(
      request,
      { grantedPermissions: ["file_system"], scope: "session" },
      { idempotencyKey: "resolve-permission" },
    );
    await completed;

    await expect(runtime.client.request("inspect/pending")).resolves.toEqual({
      responses: [
        {
          id: "fake-permissions-1",
          result: {
            permissions: {
              fileSystem: {
                entries: [
                  {
                    access: "write",
                    path: { path: "/workspace/CodeAgent/.cache", type: "path" },
                  },
                ],
                globScanMaxDepth: 4,
                read: null,
                write: null,
              },
            },
            scope: "session",
          },
        },
      ],
    });
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "pending_request.created",
      "pending_request.resolved",
      "message.delta",
      "message.delta",
      "item.completed",
      "usage.updated",
      "turn.completed",
    ]);
  });

  it("submits and interrupts a running turn through the full mutation path", async () => {
    const runtime = await startFakeAppServer("agent-actions");
    const provider = createCodexRuntimeProvider({ client: runtime.client });
    const server = await createCodeAgentServer({
      ...createServerOptions(provider),
      eventSessionId: "action-interrupt-session",
    });
    servers.push(server);
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = createRealtimeClient(baseUrl);
    const created = await client.startTask(project.id, { idempotencyKey: "create-interrupt" });
    const snapshot = await client.readTask(project.id, created.task.id);
    const events: AgentEvent[] = [];

    const interrupted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for interruption"));
      }, 2_000);
      const unsubscribe = client.subscribeEvents({
        afterSequence: snapshot.checkpoint.sequence,
        projectId: project.id,
        onError: reject,
        onEvent(event) {
          if (event.taskId !== created.task.id) {
            return;
          }
          events.push(event);
          if (event.type === "turn.completed") {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        onResyncRequired(message) {
          reject(new Error(`Unexpected resync: ${message.reason}`));
        },
        sessionId: snapshot.checkpoint.sessionId,
      });
    });

    const started = await client.startTurn(
      project.id,
      created.task.id,
      { attachments: [], skills: [], text: "等待中断", type: "prompt" },
      turnOptions,
      { idempotencyKey: "turn-interrupt" },
    );
    await client.interruptTurn(project.id, created.task.id, started.turn.id, {
      idempotencyKey: "interrupt-turn",
    });
    await interrupted;

    expect(events.map((event) => event.type)).toEqual(["turn.started", "turn.completed"]);
    expect(events.at(-1)).toMatchObject({
      payload: { turn: { status: "interrupted" } },
      type: "turn.completed",
    });
  });
});
