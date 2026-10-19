import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CatalogOperations, LocalCatalogStore, LocalTask } from "@codexly/core";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeConfiguration } from "./config.js";
import type { ClaudeSdk } from "./session.js";
import { ClaudeTaskTitles } from "./task-titles.js";

afterEach(() => vi.useRealTimers());

function setup(messages?: unknown[]) {
  const tasks = new Map<string, LocalTask>();
  const close = vi.fn();
  const query = vi.fn<ClaudeSdk["query"]>(() => {
    const pending = Promise.withResolvers<IteratorResult<SDKMessage>>();
    return {
      async *[Symbol.asyncIterator]() {
        if (messages) {
          for (const message of messages) yield message;
        } else {
          await pending.promise;
        }
      },
      close() {
        close();
        pending.resolve({ done: true, value: undefined });
      },
    } as unknown as Query;
  });
  const store = {
    catalog(operation: keyof CatalogOperations, payload: unknown) {
      const input = payload as LocalTask;
      if (operation === "task.read") return Promise.resolve(tasks.get(input.id) ?? null);
      if (operation === "task.patch") {
        const task = { ...tasks.get(input.id), ...input };
        tasks.set(input.id, task);
        return Promise.resolve(task);
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  } as LocalCatalogStore;
  const emit = vi.fn();
  const titles = new ClaudeTaskTitles(
    {
      query,
      getSessionMessages: () => Promise.resolve([]),
      deleteSession: () => Promise.resolve(),
    },
    new ClaudeConfiguration("/unused"),
    store,
    emit,
  );
  const start = (id = "task", text = "修复登录异常") => {
    const task: LocalTask = {
      id,
      provider: "claude",
      projectId: "p",
      sessionId: null,
      cwd: "/work",
      title: "",
      updatedAt: 1,
      archived: false,
      pinned: false,
      status: "active",
    };
    tasks.set(id, task);
    titles.start(task, { text, files: [], images: [], skills: [], textAttachments: [] });
  };
  return { titles, query, tasks, emit, start, close };
}

it("uses the shared application generator for Claude task titles", async () => {
  const h = setup();
  const generate = vi.fn(() => Promise.resolve("公共默认模型标题"));
  h.titles.config.taskTitleGenerator = generate;
  h.start();
  await vi.waitFor(() => {
    expect(h.tasks.get("task")?.title).toBe("公共默认模型标题");
  });
  expect(generate).toHaveBeenCalledWith("/work", "修复登录异常", expect.any(AbortSignal));
  expect(h.query).not.toHaveBeenCalled();
});

it.each(
  [
    [],
    [{ type: "result", subtype: "error_during_execution", is_error: true }],
    [{ type: "result", subtype: "success", result: "invalid" }],
    [{ type: "result", subtype: "success", structured_output: { title: " " } }],
    [{ type: "result", subtype: "success", result: "x".repeat(8193) }],
  ].map((messages) => ({ messages })),
)("falls back and releases the query for invalid results: %j", async ({ messages }) => {
  const h = setup(messages);
  h.start();
  await vi.waitFor(() => {
    expect(h.titles.isBusy).toBe(false);
  });
  expect(h.tasks.get("task")?.title).toBe("修复登录异常");
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.emit).toHaveBeenCalledOnce();
});

it("times out an unresponsive query and publishes the fallback", async () => {
  vi.useFakeTimers();
  const h = setup();
  h.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.titles.isBusy).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.tasks.get("task")?.title).toBe("修复登录异常");
  expect(h.titles.isBusy).toBe(false);
  expect(h.close).toHaveBeenCalledOnce();
});

it("cancels on shutdown without applying a fallback", async () => {
  const h = setup();
  h.start();
  await vi.waitFor(() => {
    expect(h.query).toHaveBeenCalledOnce();
  });
  h.titles.close();
  await vi.waitFor(() => {
    expect(h.titles.isBusy).toBe(false);
  });
  expect(h.tasks.get("task")?.title).toBe("");
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.emit).not.toHaveBeenCalled();
});

it("bounds concurrent title queries and falls back for excess tasks", async () => {
  const h = setup();
  try {
    for (let index = 0; index < 9; index++) h.start(String(index));
    await vi.waitFor(() => {
      expect(h.tasks.get("8")?.title).toBe("修复登录异常");
    });
    expect(h.query).toHaveBeenCalledTimes(8);
  } finally {
    h.titles.close();
    await vi.waitFor(() => {
      expect(h.titles.isBusy).toBe(false);
    });
  }
});
