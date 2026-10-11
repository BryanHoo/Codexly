import type { AgentCancellationSignal, AgentRuntimeProvider } from "@codexly/core";
import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  task,
} from "./app-all.test-support.js";

describe("server global search", () => {
  it.each([
    "/v1/search/tasks?archived=false&kind=history&query=test",
    "/v1/projects/codexly/tasks/task-1/search-occurrences?query=test",
  ])("HTTP 客户端断连时取消后端搜索：%s", async (url) => {
    const observed = Promise.withResolvers<AgentCancellationSignal | undefined>();
    const aborted = Promise.withResolvers<undefined>();
    const completed = Promise.withResolvers<{ data: []; nextCursor: null }>();
    const waitForCancellation = (signal: AgentCancellationSignal | undefined) => {
      observed.resolve(signal);
      signal?.addEventListener(
        "abort",
        () => {
          aborted.resolve(undefined);
          completed.resolve({ data: [], nextCursor: null });
        },
        { once: true },
      );
      return completed.promise;
    };
    const options = createServerOptions(createProvider().provider);
    const provider: AgentRuntimeProvider = {
      ...options.provider,
      search: {
        searchTasks: (_input, _scopes, signal) => waitForCancellation(signal),
        searchTaskOccurrences: (_taskId, _input, _scope, signal) => waitForCancellation(signal),
      },
    };
    const app = await createCodexlyServer({ ...options, provider });
    closeCallbacks.push(() => app.close());
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = fetch(`${address}${url}`, { signal: controller.signal }).catch(
      () => undefined,
    );
    try {
      const signal = await observed.promise;
      expect(signal).toBeDefined();
      expect(signal?.aborted).toBe(false);
      controller.abort();
      await response;
      await aborted.promise;
      expect(signal?.aborted).toBe(true);
    } finally {
      controller.abort();
      completed.resolve({ data: [], nextCursor: null });
      await response;
    }
  });

  it("交付全局任务搜索并传入全部可见作用域", async () => {
    const providerHarness = createProvider();
    const searchTasks = vi.fn(() =>
      Promise.resolve({ data: [{ snippet: "", task }], nextCursor: null }),
    );
    const options = createServerOptions(providerHarness.provider);
    const runtimeProvider: AgentRuntimeProvider = {
      ...options.provider,
      search: {
        searchTaskOccurrences: vi.fn(),
        searchTasks,
      },
    };
    const app = await createCodexlyServer({ ...options, provider: runtimeProvider });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/search/tasks?archived=false&kind=tasks&query=%E4%BB%BB%E5%8A%A1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ snippet: "", task }], nextCursor: null });
    expect(searchTasks).toHaveBeenCalledWith(
      { archived: false, kind: "tasks", query: "任务" },
      [
        { id: "temporary", kind: "temporary" },
        { id: project.id, kind: "project" },
      ],
      expect.any(AbortSignal),
    );
  });

  it("通过项目作用域读取历史匹配位置", async () => {
    const providerHarness = createProvider();
    const page = {
      data: [
        {
          itemId: "item-1",
          snippet: "历史消息",
          snippetMatchRange: { end: 4, start: 0 },
          turnCursor: "turn-cursor",
          turnId: "turn-1",
        },
      ],
      nextCursor: null,
    };
    const searchTaskOccurrences = vi.fn(() => Promise.resolve(page));
    const options = createServerOptions(providerHarness.provider);
    const runtimeProvider: AgentRuntimeProvider = {
      ...options.provider,
      search: { searchTaskOccurrences, searchTasks: vi.fn() },
    };
    const app = await createCodexlyServer({ ...options, provider: runtimeProvider });
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/search-occurrences?query=%E5%8E%86%E5%8F%B2",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(page);
    expect(searchTaskOccurrences).toHaveBeenCalledWith(
      "task-1",
      { query: "历史" },
      expect.objectContaining({ id: "codexly", kind: "project" }),
      expect.any(AbortSignal),
    );
  });
});
