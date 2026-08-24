import { describe, expect, it, vi } from "vitest";

import { FakeRpcClient } from "./agent-provider.test-support.js";
import { CodexFuzzyFileSearchService } from "./fuzzy-file-search.js";

const searchInput = {
  projectId: "project-1",
  query: "agent",
  roots: ["/workspace/project"],
  sessionId: "search-1",
} as const;

function createService(
  client: FakeRpcClient,
  options: Readonly<{ idleTimeoutMs?: number }> = {},
): CodexFuzzyFileSearchService {
  const service = new CodexFuzzyFileSearchService(client, options);
  client.onNotification((notification) => {
    service.receiveNotification(notification.method, notification.params);
  });
  return service;
}

function emitFiles(
  client: FakeRpcClient,
  query: string,
  files: readonly Record<string, unknown>[],
): void {
  client.emitNotification("fuzzyFileSearch/sessionUpdated", {
    files,
    query,
    sessionId: searchInput.sessionId,
  });
}

function emitCompleted(client: FakeRpcClient): void {
  client.emitNotification("fuzzyFileSearch/sessionCompleted", {
    sessionId: searchInput.sessionId,
  });
}

describe("CodexFuzzyFileSearchService", () => {
  it("starts one native index and reuses it for later queries", async () => {
    const client = new FakeRpcClient([{}, {}, {}]);
    const service = createService(client);

    const first = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toEqual([
        {
          method: "fuzzyFileSearch/sessionStart",
          params: { roots: ["/workspace/project"], sessionId: "search-1" },
        },
        {
          method: "fuzzyFileSearch/sessionUpdate",
          params: { query: "agent", sessionId: "search-1" },
        },
      ]);
    });
    emitFiles(client, "agent", [
      {
        file_name: "agent.ts",
        indices: [0, 1],
        match_type: "file",
        path: "src/agent.ts",
        root: "/workspace/project",
        score: 100,
      },
      {
        file_name: "agent",
        indices: [0, 1],
        match_type: "directory",
        path: "src/agent",
        root: "/workspace/project",
        score: 90,
      },
    ]);
    emitCompleted(client);

    await expect(first).resolves.toEqual({
      data: [{ name: "agent.ts", path: "src/agent.ts", rootPath: "/workspace/project" }],
    });

    const second = service.search({ ...searchInput, query: "runtime" });
    await vi.waitFor(() => {
      expect(client.calls.at(-1)).toEqual({
        method: "fuzzyFileSearch/sessionUpdate",
        params: { query: "runtime", sessionId: "search-1" },
      });
    });
    emitFiles(client, "runtime", []);
    emitCompleted(client);

    await expect(second).resolves.toEqual({ data: [] });
    expect(client.calls.filter((call) => call.method.endsWith("sessionStart"))).toHaveLength(1);
  });

  it("serializes native queries and keeps only the latest pending query", async () => {
    const client = new FakeRpcClient([{}, {}, {}, {}]);
    const service = createService(client);

    const previous = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(2);
    });
    const skipped = service.search({ ...searchInput, query: "runtime" });
    await expect(previous).rejects.toMatchObject({ name: "AbortError" });
    const current = service.search({ ...searchInput, query: "fuzzy" });
    await expect(skipped).rejects.toMatchObject({ name: "AbortError" });

    // 旧查询完成前不得发送替换查询，避免无 query 的完成通知命中新等待者。
    expect(client.calls).toHaveLength(2);
    emitFiles(client, "agent", []);
    emitCompleted(client);
    await vi.waitFor(() => {
      expect(client.calls.at(-1)).toEqual({
        method: "fuzzyFileSearch/sessionUpdate",
        params: { query: "fuzzy", sessionId: "search-1" },
      });
    });
    expect(client.calls.filter((call) => call.method === "fuzzyFileSearch/sessionUpdate")).toEqual([
      {
        method: "fuzzyFileSearch/sessionUpdate",
        params: { query: "agent", sessionId: "search-1" },
      },
      {
        method: "fuzzyFileSearch/sessionUpdate",
        params: { query: "fuzzy", sessionId: "search-1" },
      },
    ]);

    let settled = false;
    void current.finally(() => {
      settled = true;
    });
    emitCompleted(client);
    await Promise.resolve();
    expect(settled).toBe(false);

    emitFiles(client, "fuzzy", [
      {
        file_name: "fuzzy.ts",
        indices: null,
        match_type: "file",
        path: "src/fuzzy.ts",
        root: "/workspace/project",
        score: 80,
      },
    ]);
    emitCompleted(client);

    await expect(current).resolves.toEqual({
      data: [{ name: "fuzzy.ts", path: "src/fuzzy.ts", rootPath: "/workspace/project" }],
    });
  });

  it("reuses the validated snapshot when an unchanged query only completes", async () => {
    const client = new FakeRpcClient([{}, {}, {}]);
    const service = createService(client);

    const first = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(2);
    });
    emitFiles(client, "agent", [
      {
        file_name: "agent.ts",
        match_type: "file",
        path: "src/agent.ts",
        root: "/workspace/project",
      },
    ]);
    emitCompleted(client);
    const expected = {
      data: [{ name: "agent.ts", path: "src/agent.ts", rootPath: "/workspace/project" }],
    };
    await expect(first).resolves.toEqual(expected);

    const repeated = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(3);
    });
    emitCompleted(client);

    await expect(repeated).resolves.toEqual(expected);
  });

  it("cancels the current waiter through the request signal", async () => {
    const client = new FakeRpcClient([{}, {}, {}]);
    const service = createService(client);
    const controller = new AbortController();

    const pending = service.search({ ...searchInput, signal: controller.signal });
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(2);
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await service.stop(searchInput.projectId, searchInput.sessionId);
  });

  it("stops the native session and rejects pending work", async () => {
    const client = new FakeRpcClient([{}, {}, {}]);
    const service = createService(client);

    const pending = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(2);
    });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await service.stop("project-1", "search-1");

    await rejection;
    expect(client.calls.at(-1)).toEqual({
      method: "fuzzyFileSearch/sessionStop",
      params: { sessionId: "search-1" },
    });
  });

  it("stops project sessions when the runtime releases their owner", async () => {
    const client = new FakeRpcClient([{}, {}, {}]);
    const service = createService(client);

    const pending = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(2);
    });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await service.releaseProject("project-1");

    await rejection;
    expect(client.calls.at(-1)).toEqual({
      method: "fuzzyFileSearch/sessionStop",
      params: { sessionId: "search-1" },
    });
  });

  it("reclaims an idle completed session", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeRpcClient([{}, {}, {}]);
      const service = createService(client, { idleTimeoutMs: 100 });

      const pending = service.search(searchInput);
      await Promise.resolve();
      await Promise.resolve();
      expect(client.calls).toHaveLength(2);
      emitFiles(client, "agent", []);
      emitCompleted(client);
      await expect(pending).resolves.toEqual({ data: [] });

      await vi.advanceTimersByTimeAsync(100);
      expect(client.calls.at(-1)).toEqual({
        method: "fuzzyFileSearch/sessionStop",
        params: { sessionId: "search-1" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects reuse of a session by another project", async () => {
    const client = new FakeRpcClient([{}, {}, {}]);
    const service = createService(client);

    const pending = service.search(searchInput);
    await vi.waitFor(() => {
      expect(client.calls).toHaveLength(2);
    });

    await expect(service.search({ ...searchInput, projectId: "project-2" })).rejects.toThrow(
      "another project or root set",
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await service.stop("project-1", "search-1");
    await rejection;
  });
});
