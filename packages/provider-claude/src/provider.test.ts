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
afterEach(async () => {
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
  const close = vi.fn(() => {
    closed = true;
    next?.({ done: true, value: undefined });
  });
  const query = vi.fn(
    ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
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
  );
  return { provider, config, tasks, query, received, send, close };
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
