import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  query,
  getSessionInfo,
  getSessionMessages,
  deleteSession,
  forkSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { CatalogOperations, LocalCatalogStore, LocalTask } from "@codexly/core";
import type { AgentTurnOptions } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { ClaudeConfiguration, claudeEnvironment } from "./config.js";
import { ClaudeRuntime } from "./runtime.js";
import { ClaudeTurnProjection } from "./turn-projection.js";

async function localApi(tool?: { name: string; input: Record<string, unknown> }) {
  const requests: {
    path: string;
    key: string | undefined;
    authorization: string | undefined;
    body: string;
  }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      requests.push({
        path: request.url ?? "",
        key: request.headers["x-api-key"] as string | undefined,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (request.url?.includes("count_tokens")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      if (!request.url?.includes("/messages")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(raw) as { stream?: boolean; tools?: { name: string }[] };
      const useTool =
        tool &&
        body.tools?.some((entry) => entry.name === tool.name) &&
        !raw.includes("native-tool");
      const message = {
        id: `msg_contract_${String(requests.length)}`,
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: useTool
          ? [{ type: "tool_use", id: "native-tool", ...tool }]
          : [{ type: "text", text: "local-contract-ok" }],
        stop_reason: useTool ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      if (!body.stream) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(message));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of [
        { type: "message_start", message: { ...message, content: [], stop_reason: null } },
        {
          type: "content_block_start",
          index: 0,
          content_block: useTool
            ? { type: "tool_use", id: "native-tool", name: tool.name, input: {} }
            : { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: useTool
            ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) }
            : { type: "text_delta", text: "local-contract-ok" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: 5 },
        },
        { type: "message_stop" },
      ])
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    })().catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test API address");
  return {
    requests,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

it.each([
  { modelContextWindow: 400000, autoCompactWindow: 300000, expected: 300000 },
  { modelContextWindow: 500000, autoCompactWindow: null, expected: 500000 },
  { modelContextWindow: null, autoCompactWindow: null, expected: 200000 },
])(
  "真实 SDK 从原生配置读取自定义模型窗口：$expected",
  async ({ expected, ...windows }) => {
    const root = await mkdtemp(join(tmpdir(), "claude-context-contract-"));
    const api = await localApi();
    const config = new ClaudeConfiguration(root, join(root, "native"));
    await config.writeSettings({
      ...(await config.readSettings()),
      ...windows,
      modelAliases: { opus: "", sonnet: "gpt-6.1-sol", haiku: "" },
    });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 25000);
    const gate = Promise.withResolvers<undefined>();
    // 只读取 SDK 本地 summary，不发送提示词或付费推理，也不读取开发机配置。
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/u.test(key),
      ),
    );
    const stream = query({
      prompt: (async function* () {
        await gate.promise;
        yield* [];
      })(),
      options: {
        cwd: root,
        model: "sonnet",
        tools: [],
        persistSession: false,
        settingSources: ["user"],
        abortController: controller,
        settings: { apiKeyHelper: "", forceLoginMethod: "console" },
        env: {
          ...claudeEnvironment({ apiKey: "isolated-context-key", baseUrl: api.baseUrl }, inherited),
          CLAUDE_CONFIG_DIR: config.userDirectory,
        },
      },
    });
    try {
      const usage = await stream.getContextUsage({ detail: "summary" });
      expect(usage.rawMaxTokens).toBe(expected);
      expect(api.requests.filter((request) => request.path.includes("/messages"))).toHaveLength(0);
    } finally {
      clearTimeout(timer);
      gate.resolve(undefined);
      stream.close();
      await api.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  35000,
);

// 真正启动官方 SDK 配套二进制；只替换远端 API，不使用真实密钥或消耗额度。
it("runs the official Claude runtime against an isolated local Messages API", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-sdk-contract-"));
  const api = await localApi();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 25_000);
  const stream = query({
    prompt: "Reply with local-contract-ok",
    options: {
      cwd: root,
      env: {
        ...claudeEnvironment({
          apiKey: "isolated-test-key",
          baseUrl: api.baseUrl,
        }),
        CLAUDE_CONFIG_DIR: join(root, "runtime"),
      },
      abortController: controller,
      model: "claude-sonnet-4-6",
      settingSources: [],
      tools: [],
      persistSession: true,
      settings: { apiKeyHelper: "", forceLoginMethod: "console" },
      includePartialMessages: true,
    },
  });
  try {
    const messages: unknown[] = [];
    for await (const message of stream) messages.push(message);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "result", subtype: "success", result: "local-contract-ok" }),
    );
    expect(api.requests.filter((request) => request.path.includes("/messages"))).toContainEqual(
      expect.objectContaining({ key: "isolated-test-key" }),
    );
  } finally {
    clearTimeout(timer);
    stream.close();
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
}, 35_000);

it("switches the real SDK endpoint and credentials between turns while preserving native context", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-connection-contract-"));
  const a = await localApi();
  const b = await localApi();
  // 只让 SDK 加载临时原生配置，防止开发机环境中的密钥或地址覆盖本地测试服务。
  for (const key of Object.keys(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/u.test(key)) vi.stubEnv(key, undefined);
  }
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "native"));
  const tasks = new Map<string, LocalTask>();
  const store = {
    catalog(operation: keyof CatalogOperations, payload: unknown) {
      const value = payload as LocalTask;
      if (operation === "task.read") return Promise.resolve(tasks.get(value.id) ?? null);
      if (operation === "task.put" || operation === "task.patch") {
        const task = { ...tasks.get(value.id), ...value };
        tasks.set(value.id, task);
        return Promise.resolve(task);
      }
      throw new Error(`Unexpected catalog operation: ${operation}`);
    },
  } as LocalCatalogStore;
  const sdkQuery = vi.fn(query);
  const runtime = new ClaudeRuntime(root, store, {
    query: sdkQuery,
    getSessionInfo,
    getSessionMessages,
    deleteSession,
  });
  const provider = runtime.forScope({
    id: "p",
    kind: "project",
    rootPath: root,
    runtimeWorkspaceRoots: [root],
  });
  const task = await provider.startTask();
  // 隔离连接切换的请求计数，避免把独立 Haiku 标题请求计入主会话。
  await provider.renameTask(task.id, "验证连接切换");
  const options = {
    model: "claude-sonnet-4-6",
    reasoningEffort: "",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
    engineOptions: { engine: "claude", permissionMode: "default" },
  } as const;
  const executionQueries = () =>
    sdkQuery.mock.calls.filter(([input]) => input.options?.persistSession);
  const send = async (text: string, turnOptions: AgentTurnOptions = options) => {
    const turn = await provider.startTurn(
      task.id,
      {
        text,
        files: [],
        images: [],
        skills: [],
        textAttachments: [],
      },
      turnOptions,
    );
    await vi.waitFor(
      async () => {
        expect(provider.isBusy).toBe(false);
        expect(
          (await provider.readTask(task.id))?.turns.find((item) => item.id === turn.id)?.status,
        ).toBe("completed");
      },
      { timeout: 15_000 },
    );
  };
  const messages = (api: Awaited<ReturnType<typeof localApi>>) =>
    api.requests.filter(
      (request) => request.path.includes("/messages") && !request.path.includes("count_tokens"),
    );
  try {
    await runtime.configure({ baseUrl: a.baseUrl, apiKey: "isolated-key-a", authType: "apiKey" });
    await send("Remember connection-context-proof-42");
    const sessionId = tasks.get(task.id)?.sessionId;
    // 相同配置保存不得重建查询，保证正常连续对话仍复用进程。
    await runtime.configure({ baseUrl: a.baseUrl, apiKey: "isolated-key-a", authType: "apiKey" });
    await send("Continue with the same connection");
    expect(executionQueries()).toHaveLength(1);
    expect(messages(a).map((request) => request.key)).toEqual(["isolated-key-a", "isolated-key-a"]);

    // 使用真实 SDK 控制模型、强度和权限；模式切换不得重启进程或丢失前文。
    await send("Continue with another model and plan permissions", {
      ...options,
      model: "claude-opus-4-6",
      reasoningEffort: "high",
      engineOptions: { engine: "claude", permissionMode: "plan" },
    });
    expect(JSON.parse(messages(a).at(-1)?.body ?? "{}")).toMatchObject({
      model: "claude-opus-4-6",
    });
    expect(messages(a).at(-1)?.body).toContain("connection-context-proof-42");
    await send("Continue with explicit bypass permissions", {
      ...options,
      engineOptions: { engine: "claude", permissionMode: "bypassPermissions" },
    });
    await send("Restore normal permissions", options);
    expect(executionQueries()).toHaveLength(1);
    // 运行时切换可能触发 SDK 自身的辅助请求；只锁住换址后旧服务不再接收请求。
    const requestsBeforeSwitch = messages(a).length;

    await runtime.configure({ baseUrl: b.baseUrl, apiKey: "isolated-key-b", authType: "apiKey" });
    await send("Continue after switching service");
    expect(messages(a)).toHaveLength(requestsBeforeSwitch);
    expect(messages(b).map((request) => request.key)).toEqual(["isolated-key-b"]);
    expect(messages(b)[0]?.body).toContain("connection-context-proof-42");

    // 外部编辑原生配置不会经过 runtime.configure，同样必须使旧连接失效。
    const settingsPath = join(runtime.configuration.userDirectory, "settings.json");
    const native = JSON.parse(await readFile(settingsPath, "utf8")) as {
      env: Record<string, string>;
    };
    native.env["ANTHROPIC_API_KEY"] = "rotated-key-b";
    await writeFile(settingsPath, JSON.stringify(native));
    await send("Continue after rotating the key");
    expect(messages(b).at(-1)?.key).toBe("rotated-key-b");

    await runtime.configure({
      baseUrl: b.baseUrl,
      apiKey: "isolated-token-b",
      authType: "authToken",
    });
    await send("Continue with bearer authentication");
    expect(messages(b).at(-1)?.authorization).toBe("Bearer isolated-token-b");
    expect(messages(b).at(-1)?.key).toBeUndefined();
    await runtime.configure({
      baseUrl: b.baseUrl,
      apiKey: "rotated-token-b",
      authType: "authToken",
    });
    await send("Continue after rotating the bearer token");
    expect(messages(b).at(-1)?.authorization).toBe("Bearer rotated-token-b");
    expect(messages(b).at(-1)?.key).toBeUndefined();
    expect(messages(a)).toHaveLength(requestsBeforeSwitch);
    expect(messages(b)).toHaveLength(4);
    expect(executionQueries()).toHaveLength(5);
    for (const [input] of executionQueries().slice(1))
      expect(input.options?.resume).toBe(sessionId);
  } finally {
    await provider.stopSession(task.id);
    runtime.close();
    vi.unstubAllEnvs();
    await Promise.all([a.close(), b.close()]);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it("forks a real native transcript at the clicked reply, re-forks remapped messages and compacts that session", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-session-actions-"));
  const api = await localApi();
  for (const key of Object.keys(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/u.test(key)) vi.stubEnv(key, undefined);
  }
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "native"));
  const tasks = new Map<string, LocalTask>();
  const store = {
    catalog(operation: keyof CatalogOperations, payload: unknown) {
      const value = payload as LocalTask;
      if (operation === "task.read") return Promise.resolve(tasks.get(value.id) ?? null);
      if (operation === "task.put" || operation === "task.patch") {
        const task = { ...tasks.get(value.id), ...value };
        tasks.set(value.id, task);
        return Promise.resolve(task);
      }
      if (operation === "task.remove") return Promise.resolve(tasks.delete(value.id));
      throw new Error(`Unexpected catalog operation: ${operation}`);
    },
  } as LocalCatalogStore;
  const runtime = new ClaudeRuntime(root, store, {
    query,
    getSessionInfo,
    getSessionMessages,
    deleteSession,
    forkSession,
  });
  const provider = runtime.forScope({
    id: "p",
    kind: "project",
    rootPath: root,
    runtimeWorkspaceRoots: [root],
  });
  const options = {
    model: "claude-sonnet-4-6",
    reasoningEffort: "",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
    engineOptions: { engine: "claude", permissionMode: "default" },
  } as const;
  const send = async (id: string, text: string) => {
    const turn = await provider.startTurn(
      id,
      { text, files: [], images: [], skills: [], textAttachments: [] },
      options,
    );
    await vi.waitFor(
      () => {
        expect(provider.isBusy).toBe(false);
      },
      { timeout: 15_000 },
    );
    expect((await provider.readTask(id))?.turns.find((entry) => entry.id === turn.id)?.status).toBe(
      "completed",
    );
    return turn;
  };
  try {
    await runtime.configure({
      baseUrl: api.baseUrl,
      apiKey: "isolated-action-key",
      authType: "apiKey",
    });
    const task = await provider.startTask();
    const first = await send(task.id, "before-fork-proof-42");
    await send(task.id, "after-fork-proof-73");
    const originalId = tasks.get(task.id)?.sessionId;
    if (!originalId) throw new Error("Missing native source session");
    const sourceMessages = await getSessionMessages(originalId, { dir: root });
    const countBeforeFork = api.requests.length;
    const fork = await provider.forkTask(task.id, first.id);
    const forkId = tasks.get(fork.id)?.sessionId;
    if (!forkId) throw new Error("Missing native fork session");
    expect(forkId).not.toBe(originalId);
    const forkMessages = await getSessionMessages(forkId, { dir: root });
    expect(JSON.stringify(forkMessages)).toContain("before-fork-proof-42");
    expect(JSON.stringify(forkMessages)).not.toContain("after-fork-proof-73");
    expect(forkMessages[0]?.uuid).not.toBe(sourceMessages[0]?.uuid);
    expect((await provider.readTask(fork.id))?.turns.map((turn) => turn.id)).toEqual([first.id]);
    const nested = await provider.forkTask(fork.id, first.id);
    expect(api.requests).toHaveLength(countBeforeFork);
    await send(nested.id, "continue-nested-fork");
    const latest = api.requests.findLast(
      (request) => request.path.includes("/messages") && !request.path.includes("count_tokens"),
    );
    expect(latest?.body).toContain("before-fork-proof-42");
    expect(latest?.body).not.toContain("after-fork-proof-73");
    await provider.compactTask(nested.id, options);
    await vi.waitFor(
      () => {
        expect(provider.isBusy).toBe(false);
      },
      { timeout: 15_000 },
    );
    const snapshot = await provider.readTask(nested.id);
    expect(snapshot?.turns.at(-1)?.status).toBe("completed");
    expect(snapshot?.turns.at(-1)?.items).toContainEqual(
      expect.objectContaining({ role: "user", text: "/compact" }),
    );
    expect(tasks.get(nested.id)?.sessionId).not.toBe(originalId);
    expect(JSON.stringify(await getSessionMessages(originalId, { dir: root }))).toContain(
      "after-fork-proof-73",
    );
  } finally {
    for (const id of tasks.keys()) await provider.stopSession(id);
    runtime.close();
    vi.unstubAllEnvs();
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

// 使用真实 Bash 工具结果验证字段语义；隔离本地 API 和工作目录，不依赖真实凭据。
it("projects a real SDK Bash result into the shared command item", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-bash-projection-"));
  const api = await localApi({ name: "Bash", input: { command: "printf native-command-proof" } });
  const turn = new ClaudeTurnProjection("task", "turn", undefined, () => undefined);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 25_000);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/u.test(key)),
  );
  const stream = query({
    prompt: "Run the command and report the result",
    options: {
      cwd: root,
      env: {
        ...claudeEnvironment({ apiKey: "isolated-test-key", baseUrl: api.baseUrl }, inherited),
        CLAUDE_CONFIG_DIR: join(root, "native"),
      },
      abortController: controller,
      model: "claude-sonnet-4-6",
      settingSources: [],
      tools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settings: { apiKeyHelper: "", forceLoginMethod: "console" },
      includePartialMessages: true,
    },
  });
  try {
    for await (const message of stream) turn.receive(message);
    expect(turn.status).toBe("completed");
    const command = turn.snapshot().items.find((item) => item.id === "native-tool");
    expect(command).toMatchObject({
      type: "command",
      command: "printf native-command-proof",
      output: "native-command-proof",
      status: "completed",
    });
    expect(command).not.toHaveProperty("exitCode");
    if (command?.type === "command") expect(command.cwd.endsWith(root)).toBe(true);
  } finally {
    clearTimeout(timer);
    stream.close();
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
}, 35_000);
