import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  CatalogOperations,
  LocalCatalogStore,
  LocalTask,
  AgentProviderEvent,
  AgentProviderTurnInput,
} from "@codexly/core";
import type { AgentTurn, AgentTurnOptions } from "@codexly/protocol";
import { ClaudeConfiguration } from "./config.js";
import { ClaudeHistory } from "./history.js";
import { ClaudeAgentProvider, type ClaudeSdk } from "./provider.js";

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

async function harness(getSessionInfo?: ClaudeSdk["getSessionInfo"], idleTimeoutMs = 40) {
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
      if (operation === "task.remove") {
        tasks.delete(input.id);
        return Promise.resolve();
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
  const deleteSession = vi.fn(() => Promise.resolve());
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
  const createProvider = (configuration = config) => {
    const provider = new ClaudeAgentProvider(
      { id: "p", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] },
      store,
      configuration,
      {
        query,
        deleteSession,
        getSessionMessages: () => Promise.resolve([]),
        ...(getSessionInfo ? { getSessionInfo } : {}),
      },
      undefined,
      idleTimeoutMs,
    );
    providers.push(provider);
    cleanup.push(async () => {
      for (const id of tasks.keys()) await provider.stopSession(id);
    });
    return provider;
  };
  const provider = createProvider();
  return {
    provider,
    restart: createProvider,
    config,
    tasks,
    query,
    received,
    send,
    close,
    stopTask,
    deleteSession,
    end: () => {
      closed = true;
      next?.({ done: true, value: undefined });
      next = undefined;
    },
  };
}

it("keeps consuming the SDK session after truncated tool preview JSON", async () => {
  const h = await harness(undefined, 60_000);
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await h.provider.startTurn(task.id, prompt, options);
  const stream = (event: unknown) => {
    h.send({ type: "stream_event", event });
  };
  stream({ type: "message_start", message: { id: "truncated" } });
  stream({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "read", name: "Read", input: {} },
  });
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"file_path":' },
  });
  stream({ type: "content_block_stop", index: 0 });
  stream({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
  // SDK 可以继续处理截断并发出后续消息；预览错误不能替它终止执行。
  h.send({
    type: "assistant",
    message: {
      id: "continued",
      content: [{ type: "text", text: "continued after incomplete input" }],
    },
  });
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(async () => {
    const turn = (await h.provider.readTask(task.id))?.turns[0];
    expect(turn?.status).toBe("completed");
    expect(turn?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message", text: "continued after incomplete input" }),
      ]),
    );
  });
  expect(h.close).not.toHaveBeenCalled();
  expect(events.some((event) => event.type === "provider.error")).toBe(false);
  await h.provider.startTurn(task.id, prompt, options);
  expect(h.query).toHaveBeenCalledOnce();
  h.send({ type: "result", subtype: "success" });
});

describe("Claude attachment history", () => {
  it("does not start the SDK or publish a turn when attachment persistence fails", async () => {
    const h = await harness();
    const task = await h.provider.startTask();
    const events: AgentProviderEvent[] = [];
    h.provider.subscribeEvents((event) => events.push(event));
    await writeFile(h.config.attachments.directory, "blocked");
    await expect(
      h.provider.startTurn(
        task.id,
        { ...prompt, textAttachments: [{ name: "proof.txt", text: "proof" }] },
        options,
      ),
    ).rejects.toThrow("附件保存失败");
    expect(h.query).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(await h.config.history.active(task.id)).toBeUndefined();
  });

  it("restores attachment references and bytes after restart without embedding bodies in events", async () => {
    const h = await harness();
    const task = await h.provider.startTask();
    const root = h.config.history.directory;
    const imagePath = join(root, "..", "proof.png");
    const filePath = join(root, "..", "proof.pdf");
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(imagePath, image);
    await writeFile(filePath, "%PDF-1.7\nproof");
    const input: AgentProviderTurnInput = {
      ...prompt,
      images: [{ path: imagePath, mediaType: "image/png", detail: "auto" }],
      files: [{ path: filePath, name: "proof.pdf", mediaType: "application/pdf" }],
      textAttachments: [{ name: "proof.txt", text: "附件完整正文" }],
    };
    const events: AgentProviderEvent[] = [];
    h.provider.subscribeEvents((event) => events.push(event));
    const turn = await h.provider.startTurn(task.id, input, options);
    const user = turn.items.find((item) => item.type === "message" && item.role === "user");
    assert(user?.type === "message");
    expect(user.attachments?.map((attachment) => attachment.name).sort()).toEqual([
      "proof.pdf",
      "proof.png",
      "proof.txt",
    ]);
    assert(user.attachments);
    const attachments = user.attachments;
    await vi.waitFor(() => {
      expect(h.received.length).toBe(2);
    });
    expect(JSON.stringify(h.received[1])).toContain("附件完整正文");
    // 在回合仍运行时重建配置，证明检查点及附件授权都来自磁盘。
    const freshConfig = new ClaudeConfiguration(join(root, ".."), h.config.userDirectory);
    const restored = h.restart(freshConfig);
    expect((await restored.readTask(task.id))?.turns[0]?.items).toContainEqual(user);
    await rm(imagePath);
    await rm(filePath);
    for (const attachment of attachments) {
      const content = await restored.readTaskAttachment(task.id, attachment.id);
      assert(content);
      expect(content.name).toBe(attachment.name);
      expect(Buffer.from(content.content)).toEqual(
        attachment.kind === "image"
          ? image
          : Buffer.from(attachment.kind === "text" ? "附件完整正文" : "%PDF-1.7\nproof"),
      );
      const other = await restored.startTask();
      expect(await restored.readTaskAttachment(other.id, attachment.id)).toBeUndefined();
    }
    h.send({ type: "result", subtype: "success", result: "done" });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    });
    await h.provider.stopSession(task.id);
    const afterRestart = h.restart(
      new ClaudeConfiguration(join(root, ".."), h.config.userDirectory),
    );
    expect((await afterRestart.readTask(task.id))?.turns[0]?.items).toContainEqual(user);
    for (const attachment of attachments)
      expect(await afterRestart.readTaskAttachment(task.id, attachment.id)).toBeDefined();
    expect(JSON.stringify(events)).not.toContain(image.toString("base64"));
    expect(JSON.stringify(events)).not.toContain("附件完整正文");
  });
});

describe("Claude session recovery", () => {
  it("persists local command output when the result contains no repeated text", async () => {
    const h = await harness();
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, { ...prompt, text: "/usage" }, options);
    h.send({
      type: "system",
      subtype: "local_command_output",
      uuid: "local-output",
      session_id: h.tasks.get(task.id)?.sessionId,
      content: "本地命令输出",
    });
    h.send({ type: "result", subtype: "success", result: "" });
    await vi.waitFor(async () => {
      expect((await h.provider.readTask(task.id))?.status).toBe("idle");
    });
    await h.provider.stopSession(task.id);
    const restored = await h.restart().readTask(task.id);
    expect(restored?.turns.at(-1)?.items).toContainEqual(
      expect.objectContaining({ type: "message", role: "assistant", text: "本地命令输出" }),
    );
  });

  it("explicitly enables task tracking tools for models without default task tools", async () => {
    const h = await harness();
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, prompt, options);
    expect((h.received[0] as Options).env?.["CLAUDE_CODE_ENABLE_TODO_TOOLS"]).toBe("1");
  });

  it("preserves a success result delivered as the first SDK message when metadata storage fails", async () => {
    const h = await harness();
    const task = await h.provider.startTask();
    const events: AgentProviderEvent[] = [];
    h.provider.subscribeEvents((event) => events.push(event));
    const turn = await h.provider.startTurn(task.id, prompt, options);
    const failure = vi
      .spyOn(h.config.history, "saveMetadata")
      .mockRejectedValue(new Error("disk full"));
    try {
      h.send({ type: "result", subtype: "success", result: "真实成功结果" });
      await vi.waitFor(() => {
        expect(events.find((event) => event.type === "turn.completed")?.payload).toMatchObject({
          turn: {
            id: turn.id,
            status: "completed",
            error: null,
            persistence: { status: "failed" },
          },
        });
      });
      await h.provider.stopSession(task.id);
    } finally {
      failure.mockRestore();
    }
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "retains the real %s result in memory when even the recovery journal cannot be written",
    async (status) => {
      const h = await harness();
      const task = await h.provider.startTask();
      const events: AgentProviderEvent[] = [];
      h.provider.subscribeEvents((event) => events.push(event));
      const turn = await h.provider.startTurn(task.id, prompt, options);
      h.send({ type: "system", subtype: "init", model: "test-model", mcp_servers: [] });
      await vi.waitFor(async () => {
        expect((await h.config.history.metadata(task.id))?.sessionInitialized).toBe(true);
      });
      const failure = vi
        .spyOn(h.config.history, "saveRecovery")
        .mockRejectedValue(new Error("disk full"));
      try {
        if (status === "interrupted") await h.provider.interruptTurn(task.id, turn.id);
        else
          h.send(
            status === "completed"
              ? { type: "result", subtype: "success", result: "真实成功结果" }
              : {
                  type: "result",
                  subtype: "error_during_execution",
                  errors: ["模型执行失败"],
                  is_error: true,
                },
          );
        await vi.waitFor(() => {
          expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
        });
        await h.provider.stopSession(task.id);
        const snapshot = await h.provider.readTask(task.id);
        expect(snapshot?.turns.at(-1)).toMatchObject({
          id: turn.id,
          status,
          persistence: { status: "failed", error: "disk full" },
        });
        expect(snapshot?.turns.at(-1)?.error).not.toBe("disk full");
        expect(h.provider.isBusy).toBe(true);
        expect(h.tasks.get(task.id)?.status).toBe("active");
        await expect(h.provider.startTurn(task.id, prompt, options)).rejects.toThrow(/持久化/);
        failure.mockRestore();
        expect((await h.provider.readTask(task.id))?.turns.at(-1)).not.toHaveProperty(
          "persistence",
        );
        expect(h.provider.isBusy).toBe(false);
        expect((await h.restart().readTask(task.id))?.turns.at(-1)?.status).toBe(status);
      } finally {
        failure.mockRestore();
      }
    },
  );

  it.each(["complete", "saveMetadata"] as const)(
    "preserves execution success and retries a failed %s after a fresh provider restart",
    async (operation) => {
      const h = await harness();
      const task = await h.provider.startTask();
      const events: AgentProviderEvent[] = [];
      h.provider.subscribeEvents((event) => events.push(event));
      const turn = await h.provider.startTurn(task.id, prompt, options);
      h.send({ type: "system", subtype: "init", model: "test-model", mcp_servers: [] });
      await vi.waitFor(async () => {
        expect((await h.config.history.metadata(task.id))?.sessionInitialized).toBe(true);
      });
      const failure = vi
        .spyOn(ClaudeHistory.prototype, operation)
        .mockRejectedValue(new Error("disk full"));
      try {
        h.send({ type: "result", subtype: "success", result: "真实成功结果" });
        await vi.waitFor(() => {
          expect(events.find((event) => event.type === "turn.completed")?.payload).toMatchObject({
            turn: {
              id: turn.id,
              status: "completed",
              error: null,
              persistence: { status: "failed", error: "disk full" },
            },
          });
        });
        await h.provider.stopSession(task.id);
        expect(h.tasks.get(task.id)?.status).toBe("active");
        expect(
          events.some(
            (event) => event.type === "task.notice" && event.payload.message.includes("持久化"),
          ),
        ).toBe(true);
        // 新配置与新 Provider 都不共享旧实例的最近回合缓存或待写内存。
        const config = new ClaudeConfiguration(join(h.config.history.directory, ".."));
        const restarted = h.restart(config);
        const snapshot = await restarted.readTask(task.id);
        expect(snapshot?.status).toBe("idle");
        expect(snapshot?.turns.at(-1)).toMatchObject({
          id: turn.id,
          status: "completed",
          error: null,
          persistence: { status: "failed" },
        });
        await expect(restarted.startTurn(task.id, prompt, options)).rejects.toThrow(/持久化/);
        failure.mockRestore();
        const recovered = await restarted.readTask(task.id);
        expect(recovered?.turns.at(-1)).toMatchObject({ id: turn.id, status: "completed" });
        expect(recovered?.turns.at(-1)).not.toHaveProperty("persistence");
        expect(h.tasks.get(task.id)?.status).toBe("idle");
        const durable = new ClaudeHistory(config.history.directory);
        expect((await durable.read(task.id)).turns.map((entry) => entry.id)).toEqual([turn.id]);
        expect(await durable.active(task.id)).toBeUndefined();
      } finally {
        failure.mockRestore();
      }
    },
  );

  it("creates a prebound session without history, then resumes the exact ID once its native history exists", async () => {
    const getSessionInfo = vi.fn<NonNullable<ClaudeSdk["getSessionInfo"]>>();
    getSessionInfo.mockResolvedValue(undefined);
    const h = await harness(getSessionInfo);
    const task = await h.provider.startTask();
    const original = h.tasks.get(task.id);
    assert(original);
    h.tasks.set(task.id, { ...original, sessionId: "prebound-session" });
    await h.provider.startTurn(task.id, prompt, options);
    expect(h.query.mock.calls[0]?.[0].options).toMatchObject({ sessionId: "prebound-session" });
    expect(h.query.mock.calls[0]?.[0].options).not.toHaveProperty("resume");
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(() => {
      expect(h.close).toHaveBeenCalled();
    });
    getSessionInfo.mockResolvedValue({
      sessionId: "prebound-session",
      summary: "hello",
      lastModified: 1,
    });
    await h.restart().startTurn(task.id, prompt, options);
    expect(h.query.mock.calls[1]?.[0].options).toMatchObject({ resume: "prebound-session" });
    expect(h.query.mock.calls[1]?.[0].options).not.toHaveProperty("sessionId");
  });

  it.each(["completed", "initialized"] as const)(
    "rejects a missing %s native session after provider restart without changing history or status",
    async (state) => {
      const getSessionInfo = vi.fn(() => Promise.resolve(undefined));
      const h = await harness(getSessionInfo);
      const task = await h.provider.startTask();
      await h.provider.startTurn(task.id, prompt, options);
      h.send({ type: "system", subtype: "init", model: "test-model", mcp_servers: [] });
      if (state === "completed") {
        h.send({ type: "result", subtype: "success", result: "remember this" });
        await vi.waitFor(() => {
          expect(h.close).toHaveBeenCalled();
        });
        // 查询关闭早于退出落盘完成；重启断言必须等待旧消费器完整回收。
        await h.provider.stopSession(task.id);
      } else {
        // 初始化后尚未产生正文也已建立原生上下文，不能当成首次启动失败。
        await vi.waitFor(async () => {
          expect((await h.provider.readTask(task.id))?.threadConfiguration?.model).toBe(
            "test-model",
          );
        });
        await h.provider.stopSession(task.id);
      }
      const bound = structuredClone(h.tasks.get(task.id));
      const history = await h.config.history.read(task.id);
      const restarted = h.restart();
      const events: AgentProviderEvent[] = [];
      restarted.subscribeEvents((event) => events.push(event));
      await expect(restarted.startTurn(task.id, prompt, options)).rejects.toThrow(/恢复.*历史/);
      expect(getSessionInfo).toHaveBeenCalledWith(bound?.sessionId, { dir: bound?.cwd });
      expect(h.query).toHaveBeenCalledOnce();
      expect(h.tasks.get(task.id)).toEqual(bound);
      expect(await h.config.history.read(task.id)).toEqual(history);
      expect(await h.config.history.active(task.id)).toBeUndefined();
      expect(events).toEqual([]);
      expect(restarted.isBusy).toBe(false);
    },
  );

  it("retries creation with the same bound ID when the first SDK launch failed before initialization", async () => {
    const h = await harness(() => Promise.resolve(undefined));
    const task = await h.provider.startTask();
    h.query.mockImplementationOnce(() => {
      throw new Error("launch failed");
    });
    await expect(h.provider.startTurn(task.id, prompt, options)).rejects.toThrow("launch failed");
    const sessionId = h.tasks.get(task.id)?.sessionId;
    expect(sessionId).toBeTruthy();
    await h.restart().startTurn(task.id, prompt, options);
    expect(h.query.mock.calls[1]?.[0].options).toMatchObject({ sessionId });
    expect(h.query.mock.calls[1]?.[0].options).not.toHaveProperty("resume");
  });

  it.each(["completed", "checkpoint"] as const)(
    "rejects missing legacy sessions with only %s UI history",
    async (state) => {
      const h = await harness(() => Promise.resolve(undefined));
      const task = await h.provider.startTask();
      const original = h.tasks.get(task.id);
      assert(original);
      h.tasks.set(task.id, { ...original, sessionId: "legacy-session" });
      const turn: AgentTurn = {
        id: "legacy-turn",
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: state === "completed" ? "completed" : "running",
        error: null,
        items: [],
      };
      // 模拟旧版本只有 UI 投影，没有新增初始化标记的存量数据。
      await h.config.history.saveMetadata(task.id, {
        contextUsage: null,
        plan: null,
        model: null,
        mcpServers: [],
      });
      if (state === "checkpoint") {
        await h.config.history.checkpoint(task.id, turn);
      } else await h.config.history.complete(task.id, turn);
      await expect(h.restart().startTurn(task.id, prompt, options)).rejects.toThrow(/恢复.*历史/);
      if (state === "checkpoint")
        expect((await h.config.history.active(task.id))?.id).toBe(turn.id);
      else
        expect((await h.config.history.read(task.id)).turns.map((entry) => entry.id)).toEqual([
          turn.id,
        ]);
      expect(h.query).not.toHaveBeenCalled();
    },
  );

  it("propagates session lookup errors before writing a new checkpoint or changing task state", async () => {
    const h = await harness(() => Promise.reject(new Error("session lookup failed")));
    const task = await h.provider.startTask();
    const original = h.tasks.get(task.id);
    assert(original);
    const bound = { ...original, sessionId: "unreadable-session" };
    h.tasks.set(task.id, bound);
    await expect(h.provider.startTurn(task.id, prompt, options)).rejects.toThrow(
      "session lookup failed",
    );
    expect(h.query).not.toHaveBeenCalled();
    expect(h.tasks.get(task.id)).toEqual(bound);
    expect(await h.config.history.active(task.id)).toBeUndefined();
    expect(h.provider.isBusy).toBe(false);
  });
});

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

it.each([true, false])(
  "keeps native permission rules in their settings sources (project settings: %s)",
  async (loadProjectSettings) => {
    const h = await harness();
    const settings = {
      ...(await h.config.readSettings()),
      loadProjectSettings,
      allowedTools: ["Edit(/src/**)"],
      disallowedTools: ["Read(/private/**)"],
    };
    await h.config.writeSettings(settings);
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, prompt, options);
    const sdkOptions = h.query.mock.calls[0]?.[0].options;
    expect(sdkOptions?.settingSources).toEqual(
      loadProjectSettings ? ["user", "project", "local"] : ["user"],
    );
    // 配置规则必须保留原生来源，不能以 SDK 参数再次解释其中的相对路径。
    expect(sdkOptions?.allowedTools).toEqual([]);
    expect(sdkOptions).not.toHaveProperty("disallowedTools");
    expect(await h.config.readSettings()).toMatchObject(settings);
  },
);

it.each(["idle", "settings", "stop"] as const)(
  "replays exact session grants after %s query replacement without sharing them with another chat",
  async (replacement) => {
    const h = await harness();
    await h.config.writeSettings({
      ...(await h.config.readSettings()),
      allowedTools: ["Edit(/src/**)"],
      disallowedTools: ["Read(/private/**)"],
    });
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
    expect((await h.config.readSettings()).allowedTools).toEqual(["Edit(/src/**)"]);
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

it.each([true, false])(
  "preserves a crashed turn after continuing and restarting (read before continuing: %s)",
  async (readBeforeContinuing) => {
    const h = await harness(() =>
      Promise.resolve({ sessionId: "crashed-session", summary: "hello", lastModified: 1 }),
    );
    const task = await h.provider.startTask();
    const crashed: AgentTurn = {
      id: "crashed-turn",
      status: "running",
      startedAt: "2026-10-16T00:00:00Z",
      completedAt: null,
      error: null,
      items: [{ id: "partial", type: "message", role: "assistant", text: "未完成的回复" }],
    };
    await h.config.history.checkpoint(task.id, crashed);
    const record = h.tasks.get(task.id);
    assert(record);
    h.tasks.set(task.id, { ...record, sessionId: "crashed-session", status: "active" });
    if (readBeforeContinuing) {
      const snapshot = await h.provider.readTask(task.id);
      expect(snapshot?.turns).toEqual([
        { ...crashed, status: "failed", error: "Claude process ended before completing this turn" },
      ]);
    }

    const next = await h.provider.startTurn(task.id, prompt, options);
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(() => {
      expect(h.close).toHaveBeenCalled();
    });

    const expected = [
      { ...crashed, status: "failed", error: "Claude process ended before completing this turn" },
      expect.objectContaining({ id: next.id, status: "completed" }),
    ];
    expect((await h.config.history.read(task.id)).turns).toEqual(expected);
    expect((await h.provider.readTask(task.id))?.turns).toEqual(expected);
    expect((await h.restart().readTask(task.id))?.turns).toEqual(expected);
    expect(await h.config.history.active(task.id)).toBeUndefined();
  },
);

it.each(["completed", "failed"] as const)(
  "does not duplicate or overwrite an archived %s turn when its checkpoint survived cleanup",
  async (status) => {
    const h = await harness();
    const task = await h.provider.startTask();
    const archived: AgentTurn = {
      id: "archived-turn",
      status,
      startedAt: "2026-10-16T00:00:00Z",
      completedAt: "2026-10-16T00:00:01Z",
      error: status === "failed" ? "original failure" : null,
      items: [{ id: "answer", type: "message", role: "assistant", text: "已归档的内容" }],
    };
    await h.config.history.complete(task.id, archived);
    // 模拟完成历史已追加、旧检查点尚未清理时进程退出；重试不能再追加同一回合。
    await h.config.history.checkpoint(task.id, {
      ...archived,
      status: "running",
      completedAt: null,
      error: null,
      items: [],
    });

    const next = await h.provider.startTurn(task.id, prompt, options);
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(() => {
      expect(h.close).toHaveBeenCalled();
    });
    expect((await h.restart().readTask(task.id))?.turns).toEqual([
      archived,
      expect.objectContaining({ id: next.id, status: "completed" }),
    ]);
  },
);

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

it.each(["completed", "failed", "stopped"])(
  "projects native parent continuation after a %s background task",
  async (status) => {
    const h = await harness();
    const task = await h.provider.startTask();
    const events: AgentProviderEvent[] = [];
    h.provider.subscribeEvents((event) => events.push(event));
    const first = await h.provider.startTurn(task.id, prompt, options);
    h.send(backgroundSpawn);
    h.send({ type: "system", subtype: "task_started", task_id: "child", tool_use_id: "spawn" });
    h.send({ type: "result", subtype: "success", result: "waiting" });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    });
    h.send({ type: "system", subtype: "task_notification", task_id: "child", status });
    h.send({ type: "system", subtype: "session_state_changed", state: "running" });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === "turn.started")).toHaveLength(2);
    });
    // 后台集合已空，但主代理仍在请求模型，不能被空闲定时器回收。
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(h.close).not.toHaveBeenCalled();
    h.send({
      type: "assistant",
      message: { id: "continued", content: [{ type: "text", text: "final summary" }] },
    });
    h.send({ type: "result", subtype: "success" });
    h.send({ type: "system", subtype: "session_state_changed", state: "idle" });
    await vi.waitFor(() => {
      expect(h.close).toHaveBeenCalledOnce();
    });
    const snapshot = await h.provider.readTask(task.id);
    expect(snapshot?.turns).toHaveLength(2);
    expect(snapshot?.turns.find((turn) => turn.id === first.id)?.status).toBe("completed");
    const continuation = snapshot?.turns.find((turn) => turn.id !== first.id);
    expect(continuation?.items).toContainEqual(expect.objectContaining({ text: "final summary" }));
    expect(
      continuation?.items.some((item) => item.type === "message" && item.role === "user"),
    ).toBe(false);
    expect(h.query).toHaveBeenCalledOnce();
  },
);

it("routes late child output separately and persists a streamed native continuation", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await h.provider.startTurn(task.id, prompt, options);
  h.send(backgroundSpawn);
  h.send({ type: "system", subtype: "task_started", task_id: "child", tool_use_id: "spawn" });
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });
  h.send({
    type: "assistant",
    parent_tool_use_id: "spawn",
    message: { id: "late-child", content: [{ type: "text", text: "child output" }] },
  });
  h.send({ type: "system", subtype: "task_notification", task_id: "child", status: "completed" });
  h.send({ type: "stream_event", event: { type: "message_start", message: { id: "streamed" } } });
  h.send({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  });
  h.send({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "streamed summary" },
    },
  });
  h.send({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
  expect(events.filter((event) => event.type === "turn.started")).toHaveLength(2);
  const restored = h.restart();
  const snapshot = await restored.readTask(task.id);
  expect(snapshot?.turns).toHaveLength(2);
  expect(snapshot?.turns.flatMap((turn) => turn.items)).toContainEqual(
    expect.objectContaining({ text: "streamed summary" }),
  );
});

it("does not create a parent turn for a background permission state change", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await h.provider.startTurn(task.id, prompt, options);
  h.send(backgroundSpawn);
  h.send({ type: "system", subtype: "task_started", task_id: "child", tool_use_id: "spawn" });
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });
  // requires_action 也可能来自后台审批，仅代表会话需要保持开放，不是主代理新回合。
  h.send({ type: "system", subtype: "session_state_changed", state: "requires_action" });
  h.send({ type: "system", subtype: "task_notification", task_id: "child", status: "stopped" });
  h.send({ type: "system", subtype: "session_state_changed", state: "idle" });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
  expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
  expect((await h.provider.readTask(task.id))?.turns).toHaveLength(1);
});

it("keeps scheduled wakeups alive and releases the session after the final stop", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  const hook = h.query.mock.calls[0]?.[0].options.hooks?.Stop?.[0]?.hooks[0];
  assert(hook, "SDK Stop hook must be registered");
  const signal = new AbortController().signal;
  await hook({ hook_event_name: "Stop", session_crons: [{ id: "wake" }] } as never, undefined, {
    signal,
  });
  h.send({ type: "result", subtype: "success" });
  h.send({ type: "system", subtype: "session_state_changed", state: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(h.close).not.toHaveBeenCalled();
  h.send({
    type: "assistant",
    message: { id: "wake", content: [{ type: "text", text: "awake" }] },
  });
  await hook({ hook_event_name: "Stop", session_crons: [] } as never, undefined, { signal });
  h.send({ type: "result", subtype: "success" });
  h.send({ type: "system", subtype: "session_state_changed", state: "idle" });
  await vi.waitFor(() => {
    expect(h.close).toHaveBeenCalledOnce();
  });
  expect((await h.provider.readTask(task.id))?.turns).toHaveLength(2);
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

// 父回合完成不代表 SDK 会话空闲；两端的移除入口必须保留仍有后台工作的任务。
it.each(["archiveTask", "deleteTask"] as const)(
  "%s rejects removal while background work survives the completed parent",
  async (method) => {
    const h = await harness();
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, prompt, options);
    h.send({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bash" }] });
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(async () => {
      expect((await h.provider.readTask(task.id))?.turns[0]?.status).toBe("completed");
    });
    const before = structuredClone(h.tasks.get(task.id));
    const deleteAttachments = vi.spyOn(h.config.attachments, "deleteTask");
    await expect(h.provider[method](task.id)).rejects.toThrow("Stop the running task before");
    expect(h.tasks.get(task.id)).toEqual(before);
    expect(h.close).not.toHaveBeenCalled();
    expect(deleteAttachments).not.toHaveBeenCalled();
  },
);

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

it.each(["form", "url"] as const)(
  "bridges MCP %s elicitation through pending requests",
  async (mode) => {
    const h = await harness();
    const task = await h.provider.startTask();
    await h.provider.startTurn(task.id, prompt, options);
    const callback = h.query.mock.calls[0]?.[0].options.onElicitation;
    assert(callback, "SDK onElicitation must be registered");
    const response = callback(
      {
        serverName: "test-mcp",
        message: "请补充信息",
        mode,
        ...(mode === "url"
          ? { url: "https://example.com/auth" }
          : {
              requestedSchema: {
                type: "object",
                properties: { count: { type: "integer", minimum: 1 } },
                required: ["count"],
              },
            }),
      },
      { signal: new AbortController().signal, requestId: "elicit-1" },
    );
    const request = (await h.provider.readTask(task.id))?.pendingRequests[0];
    assert(request?.type === "mcp_elicitation");
    expect(request.mode).toBe(mode);
    await expect(
      h.provider.resolvePendingRequest({
        ...request,
        resolution: { action: "accept", content: { count: 0 } },
      }),
    ).rejects.toThrow();
    const content = mode === "form" ? { count: 2 } : {};
    await h.provider.resolvePendingRequest({
      ...request,
      resolution: { action: "accept", content },
    });
    expect(await response).toEqual(
      mode === "form" ? { action: "accept", content } : { action: "accept" },
    );
    expect((await h.provider.readTask(task.id))?.pendingRequests).toEqual([]);
  },
);

it("routes elicitation to the current turn of a reused query and cancels it on stop", async () => {
  const h = await harness(undefined, 30_000);
  const task = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(() => {
    expect(h.provider.isBusy).toBe(false);
  });
  const turn = await h.provider.startTurn(task.id, prompt, options);
  expect(h.query).toHaveBeenCalledTimes(1);
  const settings = h.query.mock.calls[0]?.[0].options;
  assert(settings);
  // 原生配置继续由 SDK 加载，不安装覆盖 Elicitation 的应用 Hook。
  expect(settings.settingSources).toContain("user");
  expect(settings.hooks?.Elicitation).toBeUndefined();
  expect(settings.hooks?.ElicitationResult).toBeUndefined();
  assert(settings.onElicitation);
  const response = settings.onElicitation(
    { serverName: "mcp", message: "登录", mode: "url", url: "https://example.com" },
    { signal: new AbortController().signal, requestId: "late" },
  );
  expect((await h.provider.readTask(task.id))?.pendingRequests[0]?.turnId).toBe(turn.id);
  await h.provider.stopSession(task.id);
  expect(await response).toEqual({ action: "cancel" });
});

it("persists SDK success after more than 64 completed subagent calls", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await h.provider.startTurn(task.id, prompt, options);
  for (let index = 0; index < 80; index++) {
    const id = `child-${String(index)}`;
    h.send({
      type: "assistant",
      message: {
        id,
        content: [{ type: "tool_use", name: "Agent", id, input: { prompt: "检查" } }],
      },
    });
    h.send({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: `实际结果 ${String(index)}` }],
      },
    });
  }
  h.send({ type: "result", subtype: "success", result: "全部完成" });
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });
  const snapshot = await h.provider.readTask(task.id);
  expect(snapshot?.turns.at(-1)).toMatchObject({ status: "completed", error: null });
  expect(JSON.stringify(snapshot)).toContain("实际结果 79");
  expect(JSON.stringify(snapshot)).toContain("全部完成");
});

it("loads every record of a long Claude turn through bounded history pages after restart", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await h.provider.startTurn(task.id, prompt, options);
  for (let index = 0; index < 70; index++) {
    h.send({
      type: "assistant",
      message: {
        id: `history-${String(index)}`,
        content: [{ type: "text", text: `记录-${String(index)} ` + "中文".repeat(3000) }],
      },
    });
  }
  h.send({ type: "result", subtype: "success", result: "done" });
  await vi.waitFor(
    () => {
      expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    },
    { timeout: 10000 },
  );
  const completed = events.find((event) => event.type === "turn.completed");
  expect(JSON.stringify(completed)).not.toContain("已省略较早执行记录");
  await h.provider.stopSession(task.id);
  const restored = h.restart();
  let page = await restored.readTask(task.id, { summary: true });
  assert.ok(page);
  expect(page.turnsNextCursor).not.toBeNull();
  const ids: string[] = [];
  const cursors = new Set<string>();
  for (;;) {
    assert.ok(page);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(512 * 1024);
    ids.unshift(...page.turns.flatMap((turn) => turn.items.map((item) => item.id)));
    if (!page.turnsNextCursor) break;
    expect(cursors.has(page.turnsNextCursor)).toBe(false);
    cursors.add(page.turnsNextCursor);
    page = await restored.readTask(task.id, { cursor: page.turnsNextCursor, summary: true });
  }
  expect(ids.slice(1)).toEqual(
    Array.from({ length: 70 }, (_, index) => `history-${String(index)}:0`),
  );
  expect(new Set(ids).size).toBe(ids.length);
});

it("permanently deletes all task history and the bound native session without touching another task", async () => {
  const h = await harness(undefined, 60_000);
  const task = await h.provider.startTask();
  const other = await h.provider.startTask();
  await h.provider.startTurn(task.id, prompt, options);
  h.send({ type: "result", subtype: "success" });
  await vi.waitFor(async () => {
    expect((await h.provider.readTask(task.id))?.turns[0]?.status).toBe("completed");
  });
  const nativeTask = structuredClone(h.tasks.get(task.id));
  assert.ok(nativeTask);
  const turn = (await h.config.history.read(task.id)).turns[0];
  assert.ok(turn);
  const metadata = await h.config.history.metadata(task.id);
  assert.ok(metadata);
  await h.config.history.complete(other.id, turn);
  await h.config.history.update(task.id, turn);
  await h.config.history.checkpoint(task.id, turn);
  await h.config.history.saveRecovery(task.id, { entries: [{ turn, mode: "complete" }], metadata });
  const attachments = await h.config.attachments.prepare(task.id, {
    ...prompt,
    textAttachments: [{ name: "secret.txt", text: "private content" }],
  });
  await h.provider.deleteTask(task.id);
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.deleteSession).toHaveBeenCalledWith(nativeTask.sessionId, { dir: nativeTask.cwd });
  expect(await h.config.history.read(task.id)).toEqual({ turns: [], cursor: null });
  expect(await h.config.history.active(task.id)).toBeUndefined();
  expect(await h.config.history.metadata(task.id)).toBeUndefined();
  expect(await h.config.history.recovery(task.id)).toBeUndefined();
  expect(await h.config.history.items.read(task.id, turn.id)).toBeUndefined();
  expect(await h.config.attachments.read(task.id, attachments[0]?.id ?? "missing")).toBeUndefined();
  expect(await readdir(join(h.config.attachments.directory, "blobs"))).toEqual([]);
  expect((await h.config.history.read(other.id)).turns).toEqual([turn]);
  expect(h.tasks.has(task.id)).toBe(false);
  await expect(h.provider.readTask(task.id)).rejects.toThrow("Task not found");
});

it("retains the catalog entry after native deletion fails and permits retry", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const record = h.tasks.get(task.id);
  assert.ok(record);
  record.sessionId = "11111111-1111-4111-8111-111111111111";
  h.deleteSession.mockRejectedValueOnce(new Error("native permission denied"));
  const events: AgentProviderEvent[] = [];
  h.provider.subscribeEvents((event) => events.push(event));
  await expect(h.provider.deleteTask(task.id)).rejects.toThrow("native permission denied");
  expect(h.tasks.has(task.id)).toBe(true);
  expect(events.some((event) => event.type === "task.removed")).toBe(false);
  await h.provider.deleteTask(task.id);
  expect(h.tasks.has(task.id)).toBe(false);
});

it("deletes a never-started task without requesting native session deletion", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  await h.provider.deleteTask(task.id);
  expect(h.deleteSession).not.toHaveBeenCalled();
  expect(h.tasks.has(task.id)).toBe(false);
});

it("discards pending persistence so a later retry cannot resurrect deleted history", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const turn: AgentTurn = {
    id: "unpersisted",
    status: "completed",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [],
  };
  const complete = vi.spyOn(h.config.history, "complete").mockRejectedValue(new Error("disk full"));
  await h.config.persistence.settleAll(task.id, [{ turn, mode: "complete" }], {
    contextUsage: null,
    plan: null,
    model: null,
    mcpServers: [],
  });
  expect(h.config.persistence.hasPending(task.id)).toBe(true);
  complete.mockRestore();
  await h.provider.deleteTask(task.id);
  expect(h.config.persistence.hasPending(task.id)).toBe(false);
  expect(await h.config.persistence.retry(task.id)).toBeUndefined();
  expect(await h.config.history.read(task.id)).toEqual({ turns: [], cursor: null });
});

it("retains the task when attachment cleanup fails and retries an already deleted native session", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const record = h.tasks.get(task.id);
  assert.ok(record);
  record.sessionId = "11111111-1111-4111-8111-111111111111";
  vi.spyOn(h.config.attachments.store, "removeTask").mockRejectedValueOnce(
    new Error("attachment denied"),
  );
  await expect(h.provider.deleteTask(task.id)).rejects.toThrow("attachment denied");
  expect(h.tasks.has(task.id)).toBe(true);
  h.deleteSession.mockRejectedValueOnce(
    new Error(`Session ${record.sessionId} not found in project directory for ${record.cwd}`),
  );
  await h.provider.deleteTask(task.id);
  expect(h.tasks.has(task.id)).toBe(false);
});

it("blocks new turns while permanent deletion is in progress", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const record = h.tasks.get(task.id);
  assert.ok(record);
  record.sessionId = "11111111-1111-4111-8111-111111111111";
  const gate = Promise.withResolvers<undefined>();
  h.deleteSession.mockReturnValueOnce(gate.promise);
  const deleting = h.provider.deleteTask(task.id);
  await vi.waitFor(() => {
    expect(h.deleteSession).toHaveBeenCalledOnce();
  });
  try {
    await expect(h.provider.startTurn(task.id, prompt, options)).rejects.toThrow("already running");
    await expect(h.provider.deleteTask(task.id)).rejects.toThrow("Stop the running task");
    expect(h.query).not.toHaveBeenCalled();
  } finally {
    gate.resolve(undefined);
    await deleting;
  }
});

it("does not delete native data for a task owned by another project", async () => {
  const h = await harness();
  const task = await h.provider.startTask();
  const record = h.tasks.get(task.id);
  assert.ok(record);
  record.projectId = "other-project";
  await expect(h.provider.deleteTask(task.id)).rejects.toThrow("Task not found");
  expect(h.deleteSession).not.toHaveBeenCalled();
  expect(h.tasks.has(task.id)).toBe(true);
  record.projectId = "p";
});

// Web 与桌面宿主复用此 Provider；同时验证事件投影和落盘后重新读取的终态。
it.each(["completed", "failed", "stopped"] as const)(
  "replays foreground promotion and late %s after the level set removes the task",
  async (outcome) => {
    const h = await harness(undefined, 60_000);
    const task = await h.provider.startTask();
    const events: AgentProviderEvent[] = [];
    h.provider.subscribeEvents((event) => events.push(event));
    const first = await h.provider.startTurn(task.id, prompt, options);
    h.send({
      ...backgroundSpawn,
      message: {
        id: "root",
        content: [
          { type: "tool_use", id: "spawn", name: "Agent", input: { run_in_background: false } },
        ],
      },
    });
    h.send({
      type: "system",
      subtype: "task_started",
      task_id: "child",
      tool_use_id: "spawn",
      run_id: "002",
      is_backgrounded: false,
    });
    h.send({
      type: "system",
      subtype: "task_updated",
      task_id: "child",
      run_id: "002",
      patch: { is_backgrounded: true },
    });
    h.send({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "child", run_id: "002" }],
    });
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    });
    expect(
      (await h.provider.readTask(task.id))?.turns[0]?.items.find((item) => item.id === "spawn"),
    ).toMatchObject({ status: "running" });
    expect(h.provider.isBusy).toBe(true);
    const second = await h.provider.startTurn(task.id, prompt, options);
    h.send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    h.send({
      type: "system",
      subtype: "task_notification",
      task_id: "child",
      run_id: "001",
      status: "failed",
      summary: "obsolete",
    });
    h.send({
      type: "system",
      subtype: "task_updated",
      task_id: "child",
      run_id: "002",
      patch: { status: outcome === "stopped" ? "killed" : outcome },
    });
    h.send({
      type: "system",
      subtype: "task_notification",
      task_id: "child",
      run_id: "002",
      status: outcome,
      summary: "late proof",
    });
    h.send({ type: "result", subtype: "success" });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(2);
    });
    const expected = outcome === "stopped" ? "interrupted" : outcome;
    const restored = await h.restart().readTask(task.id);
    expect(
      restored?.turns
        .find((turn) => turn.id === first.id)
        ?.items.find((item) => item.id === "spawn"),
    ).toMatchObject({ status: expected });
    expect(JSON.stringify(restored)).toContain("late proof");
    expect(JSON.stringify(restored)).not.toContain("obsolete");
    expect(
      events.some(
        (event) =>
          event.type === "item.completed" &&
          event.turnId === first.id &&
          event.payload.item.type === "tool" &&
          event.payload.item.status === expected,
      ),
    ).toBe(true);
    expect(
      restored?.turns
        .find((turn) => turn.id === second.id)
        ?.items.some((item) => item.id === "spawn"),
    ).toBe(false);
    expect(h.query).toHaveBeenCalledOnce();
    expect(h.provider.isBusy).toBe(false);
  },
);
