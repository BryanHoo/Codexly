import type { AgentRuntimeProvider } from "@codexly/core";
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
    expect(searchTasks).toHaveBeenCalledWith({ archived: false, kind: "tasks", query: "任务" }, [
      { id: "temporary", kind: "temporary" },
      { id: project.id, kind: "project" },
    ]);
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
    );
  });
});
