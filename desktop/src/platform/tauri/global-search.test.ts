import { describe, expect, it, vi } from "vitest";
import { TauriSidebarClient } from "./sidebar-client.js";

describe("global search IPC", () => {
  it("searches persisted tasks with bounded pages and preserves history snippets", async () => {
    const response = {
      data: [
        {
          task: {
            id: "t",
            projectId: "temporary",
            title: "任务",
            pinned: false,
            updatedAt: "2026-09-15T00:00:00Z",
          },
          snippet: "历史中的中文关键词",
        },
      ],
      nextCursor: "next",
    };
    const invoke = vi.fn().mockResolvedValue(response);
    const client = new TauriSidebarClient({
      ensureRuntime: async () => undefined,
      invoke,
    });
    expect(typeof client.searchTasks).toBe("function");
    expect(
      await client.searchTasks({ query: "中文", archived: false }),
    ).toEqual(response);
    expect(invoke).toHaveBeenCalledWith("search_tasks", {
      input: { query: "中文", archived: false },
    });
  });

  it("rejects malformed search responses", async () => {
    const client = new TauriSidebarClient({
      ensureRuntime: async () => undefined,
      invoke: vi.fn().mockResolvedValue({ data: [{ snippet: "bad" }] }),
    });
    expect(typeof client.searchTasks).toBe("function");
    await expect(
      client.searchTasks({ query: "bad", archived: false }),
    ).rejects.toThrow("INVALID_SEARCH_RESPONSE");
  });

  it("cancels searches before runtime initialization", async () => {
    const invoke = vi.fn();
    const ensureRuntime = vi.fn();
    const client = new TauriSidebarClient({ ensureRuntime, invoke });
    const controller = new AbortController();
    controller.abort();
    expect(typeof client.searchTasks).toBe("function");
    await expect(
      client.searchTasks(
        { query: "x", archived: false },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/abort/i);
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
