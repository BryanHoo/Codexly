import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  CatalogOperations,
  LocalCatalogStore,
  LocalTask,
  AgentProviderEvent,
} from "@codexly/core";
import type { AgentTurnOptions } from "@codexly/protocol";
import { ClaudeConfiguration } from "./config.js";
import { ClaudeAgentProvider } from "./provider.js";

const roots: string[] = [];
const providers: ClaudeAgentProvider[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0)) await action();
  for (const provider of providers.splice(0)) provider.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const options: AgentTurnOptions = {
  model: "test-model",
  reasoningEffort: "",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxMode: "workspace-write",
  engineOptions: { engine: "claude", permissionMode: "default" },
};
const prompt = { text: "hello", files: [], images: [], skills: [], textAttachments: [] };

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "codexly-claude-provider-"));
  roots.push(root);
  const tasks = new Map<string, LocalTask>();
  const store = {
    catalog(operation: keyof CatalogOperations, payload: unknown) {
      const input = payload as LocalTask;
      if (operation === "task.read") return Promise.resolve(tasks.get(input.id) ?? null);
      if (operation === "task.put") {
        tasks.set(input.id, structuredClone(input));
        return Promise.resolve(input);
      }
      if (operation === "task.patch") {
        const task = { ...tasks.get(input.id), ...input };
        tasks.set(input.id, task);
        return Promise.resolve(task);
      }
      if (operation === "task.list")
        return Promise.resolve({ data: [...tasks.values()], nextCursor: null });
      throw new Error(`Unexpected catalog operation ${operation}`);
    },
  } as LocalCatalogStore;
  const config = new ClaudeConfiguration(root, join(root, "user"));
  const received: unknown[] = [];
  let next: ((value: IteratorResult<SDKMessage>) => void) | undefined;
  let closed = false;
  const messages: SDKMessage[] = [];
  const stopTask = vi.fn(() => Promise.resolve());
  const close = vi.fn(() => {
    closed = true;
    next?.({ done: true, value: undefined });
  });
  const query = vi.fn(
    ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
      closed = false;
      received.push(options);
      void (async () => {
        for await (const input of prompt) received.push(input);
      })();
      const stream = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<SDKMessage>> {
          const message = messages.shift();
          return message
            ? Promise.resolve({ value: message, done: false })
            : closed
              ? Promise.resolve({ value: undefined, done: true })
              : new Promise((resolve) => {
                  next = resolve;
                });
        },
        close,
        interrupt: vi.fn(() => Promise.resolve()),
        stopTask,
      } as unknown as Query;
      return stream;
    },
  );
  const send = (value: unknown) => {
    const message = value as SDKMessage;
    if (next) {
      const resolve = next;
      next = undefined;
      resolve({ value: message, done: false });
    } else messages.push(message);
  };
  const provider = new ClaudeAgentProvider(
    { id: "p", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] },
    store,
    config,
    { query, getSessionMessages: () => Promise.resolve([]) },
    undefined,
    40,
  );
  providers.push(provider);
  cleanup.push(async () => {
    for (const id of tasks.keys()) await provider.stopSession(id);
  });
  return {
    provider,
    config,
    tasks,
    query,
    received,
    send,
    close,
    stopTask,
    end: () => {
      closed = true;
      next?.({ done: true, value: undefined });
      next = undefined;
    },
  };
}

describe("Claude provider execution boundary", () => {
  it("creates locally and delegates native authentication to the SDK", async () => {
    const h = await harness();
    const task = await h.provider.startTask();
    expect(task.engine).toBe("claude");
    expect(h.tasks.get(task.id)?.sessionId).toBeNull();
    await h.provider.startTurn(task.id, prompt, options);
    expect(h.query).toHaveBeenCalledOnce();
    expect(h.received[0]).toMatchObject({ settingSources: ["user", "project", "local"] });
    expect(h.received[0]).not.toHaveProperty("settings");
    h.send({ type: "result", subtype: "success", result: "done", is_error: false });
    await vi.waitFor(() => {
      expect(h.close).toHaveBeenCalled();
    });
  });

  it("binds the engine session before sending, rejects concurrent turns and emits a completed result", async () => {
    const h = await harness();
    await h.config.configure({ baseUrl: "https://api.anthropic.com", apiKey: "private" });
    const task = await h.provider.startTask();
    const events: AgentProviderEvent[] = [];
    h.provider.subscribeEvents((event) => events.push(event));
    const turn = await h.provider.startTurn(task.id, prompt, options);
    expect(h.tasks.get(task.id)?.sessionId).toBeTruthy();
    expect(h.received[0]).toMatchObject({
      cwd: h.tasks.get(task.id)?.cwd,
      permissionMode: "default",
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
    });
    await expect(h.provider.startTurn(task.id, prompt, options)).rejects.toThrow(/running/i);
    h.send({ type: "result", subtype: "success", result: "done", is_error: false });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    });
    expect((await h.provider.readTask(task.id))?.turns.at(-1)).toMatchObject({
      id: turn.id,
      status: "completed",
    });
    await vi.waitFor(() => {
      expect(h.close).toHaveBeenCalled();
    });
  });

  it("rejects a different engine and scopes pending requests and interruption to the bound task", async () => {
    const h = await harness();
    await h.config.configure({ baseUrl: "https://api.anthropic.com", apiKey: "private" });
    const task = await h.provider.startTask();
    const original = h.tasks.get(task.id);
    assert(original);
    h.tasks.set(task.id, { ...original, provider: "codex" });
    await expect(h.provider.startTurn(task.id, prompt, options)).rejects.toThrow(/engine/i);
    h.tasks.set(task.id, original);
    const turn = await h.provider.startTurn(task.id, prompt, options);
    await expect(h.provider.interruptTurn(task.id, "other-turn")).rejects.toThrow();
    await h.provider.interruptTurn(task.id, turn.id);
    expect((await h.provider.readTask(task.id))?.turns.at(-1)?.status).toBe("interrupted");
  });
});

it.each(["idle", "settings", "stop"] as const)(
  "replays exact session grants after %s query replacement without sharing them with another chat",
  async (replacement) => {
    const h = await harness();
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, prompt, options);
    const firstOptions = h.query.mock.calls[0]?.[0].options;
    assert(firstOptions?.canUseTool);
    const permission = firstOptions.canUseTool(
      "Bash",
      { command: "git status --short" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool",
        requestId: "session-grant",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "git status:*" }],
            behavior: "allow",
            destination: "userSettings",
          },
        ],
      },
    );
    const request = (await h.provider.readTask(task.id))?.pendingRequests[0];
    assert(request?.type === "tool_approval");
    await h.provider.resolvePendingRequest({
      ...request,
      resolution: { decision: "allow_for_session" },
    });
    expect(await permission).toMatchObject({
      updatedPermissions: [{ destination: "session" }],
    });
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(() => {
      expect(h.provider.isBusy).toBe(false);
    });
    if (replacement === "idle")
      await vi.waitFor(() => {
        expect(h.close).toHaveBeenCalledOnce();
      });
    else if (replacement === "stop") await h.provider.stopSession(task.id);
    const second = await h.provider.startTurn(task.id, prompt, {
      ...options,
      ...(replacement === "settings" ? { model: "another-model" } : {}),
    });
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.query.mock.calls[1]?.[0].options.allowedTools).toEqual(["Bash(git status:*)"]);
    await h.provider.interruptTurn(task.id, second.id);
    const other = await h.provider.startTask();
    await h.provider.startTurn(other.id, prompt, options);
    expect(h.query.mock.calls[2]?.[0].options.allowedTools).toEqual([]);
    // 授权只驻留在当前应用会话中，不能污染用户原生配置。
    expect((await h.config.readSettings()).allowedTools).toEqual([]);
  },
);

it.each(["allow", "deny"] as const)(
  "does not replay a %s decision on the next query",
  async (decision) => {
    const h = await harness();
    const task = await h.provider.startTask();
    const turn = await h.provider.startTurn(task.id, prompt, options);
    const callback = h.query.mock.calls[0]?.[0].options.canUseTool;
    assert(callback);
    const result = callback(
      "Bash",
      { command: "pwd" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool",
        requestId: "once",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "pwd" }],
            behavior: "allow",
            destination: "session",
          },
        ],
      },
    );
    const request = (await h.provider.readTask(task.id))?.pendingRequests[0];
    assert(request?.type === "tool_approval");
    await h.provider.resolvePendingRequest({ ...request, resolution: { decision } });
    await result;
    await h.provider.interruptTurn(task.id, turn.id);
    await h.provider.startTurn(task.id, prompt, options);
    expect(h.query.mock.calls[1]?.[0].options.allowedTools).toEqual([]);
  },
);

it("recovers an interrupted process checkpoint without claiming success or keeping the task locked", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.config.history.checkpoint(task.id, {
    id: "lost-turn",
    status: "running",
    startedAt: "2026-10-16T00:00:00Z",
    completedAt: null,
    error: null,
    items: [],
  });
  const record = h.tasks.get(task.id);
  assert(record);
  h.tasks.set(task.id, { ...record, status: "active" });
  const snapshot = await h.provider.readTask(task.id);
  expect(snapshot?.status).toBe("failed");
  expect(snapshot?.turns[0]?.status).toBe("failed");
  expect(h.tasks.get(task.id)?.status).toBe("failed");
  expect(h.query).not.toHaveBeenCalled();
});

it("rejects oversized Claude images before allocating their base64 or binding a session", async () => {
  const h = await harness();
  await h.config.configure({ baseUrl: "https://api.anthropic.com", apiKey: "private" });
  const task = await h.provider.startTask();
  const path = join(h.provider.scope.rootPath, "large.png");
  await writeFile(path, Buffer.alloc(5 * 1024 * 1024 + 1));
  await expect(
    h.provider.startTurn(
      task.id,
      { ...prompt, images: [{ path, mediaType: "image/png", detail: "auto" }] },
      options,
    ),
  ).rejects.toThrow(/5 MiB/);
  expect(h.query).not.toHaveBeenCalled();
  expect(h.tasks.get(task.id)?.sessionId).toBeNull();
});

it("restores context, plan and MCP metadata after recreating the provider", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  h.send({
    type: "system",
    subtype: "init",
    model: "main",
    mcp_servers: [{ name: "search", status: "connected" }],
  });
  h.send({
    type: "assistant",
    message: {
      id: "msg",
      model: "main",
      usage: { input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 5 },
      content: [
        {
          type: "tool_use",
          id: "todo",
          name: "TodoWrite",
          input: { todos: [{ content: "检查组件", status: "in_progress" }] },
        },
      ],
    },
  });
  h.send({ type: "result", subtype: "success", modelUsage: { main: { contextWindow: 200000 } } });
  await vi.waitFor(async () => {
    expect((await h.provider.readTask(task.id))?.status).toBe("idle");
  });
  const restored = new ClaudeAgentProvider(
    h.provider.scope,
    h.provider.store,
    h.config,
    h.provider.sdk,
  );
  expect(await restored.readTask(task.id)).toMatchObject({
    contextUsage: { contextWindow: 200000, usedTokens: 35 },
    plan: { steps: [{ text: "检查组件", status: "in_progress" }] },
    threadConfiguration: { model: "main" },
  });
  expect(await restored.listMcpServers(task.id)).toMatchObject({
    data: [{ name: "search", status: "connected" }],
  });
});

it("reads live MCP tools and reconnects failed servers without crossing engine boundaries", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  const stream = h.query.mock.results[0]?.value as Query | undefined;
  if (!stream) throw new Error("Missing SDK query");
  let connected = false;
  stream.mcpServerStatus = vi.fn(() =>
    Promise.resolve([
      {
        name: "search",
        status: connected ? ("connected" as const) : ("failed" as const),
        tools: connected ? [{ name: "query" }] : [],
      },
    ]),
  );
  const reconnect = vi.fn(() => {
    connected = true;
    return Promise.resolve();
  });
  stream.reconnectMcpServer = reconnect;
  expect(await h.provider.reloadMcpServers(task.id)).toMatchObject({
    data: [{ name: "search", status: "connected", toolCount: 1 }],
  });
  expect(reconnect).toHaveBeenCalledWith("search");
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalled();
  });
  expect(await h.config.history.metadata(task.id)).toMatchObject({
    mcpServers: [{ name: "search", toolCount: 1 }],
  });
});

it("uses local SDK context summaries and keeps successful execution successful if observation fails", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  const stream = h.query.mock.results[0]?.value as Query | undefined;
  if (!stream) throw new Error("Missing SDK query");
  const readContext = vi.fn(() => Promise.reject(new Error("observability unavailable")));
  stream.getContextUsage = readContext;
  h.send({
    type: "assistant",
    message: { id: "msg", model: "main", content: [], usage: { input_tokens: 10 } },
  });
  h.send({ type: "result", subtype: "success", modelUsage: { main: { contextWindow: 200000 } } });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalled();
  });
  expect(readContext).toHaveBeenCalledWith({ detail: "summary" });
  expect(await h.provider.readTask(task.id)).toMatchObject({
    status: "idle",
    contextUsage: { usedTokens: 10, contextWindow: 200000 },
  });
});

it("completes and persists a large subagent run without leaving a busy task", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await h.provider.startTurn(task.id, prompt, options);
  h.send({
    type: "assistant",
    message: {
      id: "root",
      content: [{ type: "tool_use", id: "spawn", name: "Agent", input: { prompt: "inspect" } }],
    },
  });
  for (let index = 0; index < 48; index++) {
    h.send({
      type: "assistant",
      parent_tool_use_id: "spawn",
      message: {
        id: `child-${String(index)}`,
        content: [{ type: "text", text: "large subagent output ".repeat(1024) }],
      },
    });
  }
  h.send({
    type: "system",
    subtype: "task_notification",
    tool_use_id: "spawn",
    task_id: "child",
    status: "completed",
    summary: "检查完成",
  });
  h.send({ type: "result", subtype: "success", result: "done" });
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });
  expect(h.provider.isBusy).toBe(false);
  expect((await h.provider.readTask(task.id))?.turns.at(-1)?.status).toBe("completed");
  const restored = new ClaudeAgentProvider(
    h.provider.scope,
    h.provider.store,
    h.config,
    h.provider.sdk,
  );
  expect((await restored.readTask(task.id))?.turns.at(-1)?.status).toBe("completed");
});

const backgroundSpawn = {
  type: "assistant",
  message: {
    id: "root",
    content: [
      {
        type: "tool_use",
        id: "spawn",
        name: "Agent",
        input: { prompt: "inspect", run_in_background: true },
      },
    ],
  },
};

it("consumes late background completion across turns using the original query and turn identity", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  const first = await h.provider.startTurn(task.id, prompt, options);
  h.send(backgroundSpawn);
  h.send({
    type: "system",
    subtype: "task_started",
    task_id: "child",
    tool_use_id: "spawn",
    is_backgrounded: true,
  });
  h.send({ type: "result", subtype: "success", result: "parent done" });
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });
  expect(h.close).not.toHaveBeenCalled();
  expect(h.provider.isBusy).toBe(true);
  const second = await h.provider.startTurn(task.id, { ...prompt, text: "continue" }, options);
  expect(h.query).toHaveBeenCalledOnce();
  h.send({
    type: "system",
    subtype: "task_notification",
    task_id: "child",
    status: "completed",
    summary: "late proof",
  });
  h.send({ type: "result", subtype: "success", result: "second done" });
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(2);
  });
  const snapshot = await h.provider.readTask(task.id);
  expect(
    snapshot?.turns.find((turn) => turn.id === first.id)?.items.find((item) => item.id === "spawn"),
  ).toMatchObject({ status: "completed" });
  expect(
    snapshot?.turns
      .find((turn) => turn.id === second.id)
      ?.items.some((item) => item.id === "spawn"),
  ).toBe(false);
  expect(
    events.some(
      (event) =>
        event.type === "item.completed" && event.turnId === first.id && event.itemId === "spawn",
    ),
  ).toBe(true);
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
  const restored = new ClaudeAgentProvider(
    h.provider.scope,
    h.provider.store,
    h.config,
    h.provider.sdk,
  );
  expect(
    (await restored.readTask(task.id))?.turns
      .find((turn) => turn.id === first.id)
      ?.items.find((item) => item.id === "spawn"),
  ).toMatchObject({ status: "completed" });
});

it("stops a background task independently and keeps consuming its stopped notification", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  h.send(backgroundSpawn);
  h.send({
    type: "system",
    subtype: "task_started",
    task_id: "child",
    tool_use_id: "spawn",
    is_backgrounded: true,
  });
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(async () => {
    expect((await h.provider.readTask(task.id))?.turns[0]?.status).toBe("completed");
  });
  await expect(h.provider.stopBackgroundTask(task.id, "other")).rejects.toThrow();
  await h.provider.stopBackgroundTask(task.id, "child");
  expect(h.stopTask).toHaveBeenCalledExactlyOnceWith("child");
  expect(h.close).not.toHaveBeenCalled();
  h.send({ type: "system", subtype: "task_notification", task_id: "child", status: "stopped" });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
  expect(
    (await h.provider.readTask(task.id))?.turns[0]?.items.find((item) => item.id === "spawn"),
  ).toMatchObject({ status: "interrupted" });
});

it("keeps non-agent background work alive until the authoritative task set becomes empty", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  h.send({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bash" }] });
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(async () => {
    expect((await h.provider.readTask(task.id))?.turns[0]?.status).toBe("completed");
  });
  expect(h.provider.isBusy).toBe(true);
  expect(h.close).not.toHaveBeenCalled();
  h.send({ type: "system", subtype: "task_notification", task_id: "bash", status: "completed" });
  h.send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  // level 信号与边沿通知没有顺序保证；迟到的 started 不得复活已结束任务。
  h.send({ type: "system", subtype: "task_started", task_id: "bash", is_backgrounded: true });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
  expect(h.provider.isBusy).toBe(false);
});

it.each(["ended", "stopped"] as const)(
  "settles remaining children when a session is %s without changing the completed parent",
  async (reason) => {
    const h = await harness();
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, prompt, options);
    h.send(backgroundSpawn);
    h.send({ type: "system", subtype: "task_started", task_id: "child", tool_use_id: "spawn" });
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(async () => {
      expect((await h.provider.readTask(task.id))?.turns[0]?.status).toBe("completed");
    });
    if (reason === "ended") h.end();
    else await h.provider.stopSession(task.id);
    await vi.waitFor(() => {
      expect(h.provider.isBusy).toBe(false);
    });
    expect((await h.provider.readTask(task.id))?.turns[0]).toMatchObject({ status: "completed" });
    expect(
      (await h.provider.readTask(task.id))?.turns[0]?.items.find((item) => item.id === "spawn"),
    ).toMatchObject({ status: reason === "ended" ? "failed" : "interrupted" });
  },
);

it("releases an idle session when the authoritative background set is empty even if a bookend was missed", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  h.send(backgroundSpawn);
  h.send({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "child" }] });
  h.send({ type: "result", subtype: "success" });
  h.send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
});
