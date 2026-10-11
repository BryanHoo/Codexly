import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installInactiveSnapshotMemoryLimit } from "./snapshot-memory.js";

describe("installInactiveSnapshotMemoryLimit", () => {
  let queryClient: QueryClient;
  let uninstall: () => void;

  beforeEach(() => {
    // 使用真实任务快照的 30 秒 GC，验证预算清理无需等待定时回收。
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 30_000 } } });
    uninstall = vi.fn();
  });

  afterEach(() => {
    uninstall();
    queryClient.clear();
  });

  it("evicts least-recently-updated inactive task snapshots by bytes", () => {
    uninstall = installInactiveSnapshotMemoryLimit(queryClient, 700, 10);
    const firstKey = ["projects", "project-1", "tasks", "task-1"] as const;
    const secondKey = ["projects", "project-1", "tasks", "task-2"] as const;

    queryClient.setQueryData(firstKey, { snapshot: { text: "一".repeat(100) } });
    queryClient.setQueryData(secondKey, { snapshot: { text: "二".repeat(100) } });

    expect(queryClient.getQueryData(firstKey)).toBeUndefined();
    expect(queryClient.getQueryData(secondKey)).toBeDefined();
  });

  it("immediately removes all oversized inactive snapshots from the query cache", () => {
    uninstall = installInactiveSnapshotMemoryLimit(queryClient, 1024, 12);

    // 三份正文各占 2 KiB，不能因 LRU 拒收而在 1 KiB 预算外保留 6 KiB。
    for (let index = 0; index < 3; index += 1) {
      const queryKey = ["projects", "project-1", "tasks", `task-${String(index)}`] as const;
      queryClient.setQueryData(queryKey, { text: "x".repeat(2048) });

      expect(queryClient.getQueryCache().find({ exact: true, queryKey })).toBeUndefined();
    }
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("removes a cached snapshot when an update makes it oversized", () => {
    uninstall = installInactiveSnapshotMemoryLimit(queryClient, 1024, 12);
    const firstKey = ["projects", "project-1", "tasks", "task-1"] as const;
    const updatedKey = ["projects", "project-1", "tasks", "task-2"] as const;
    const nextKey = ["projects", "project-1", "tasks", "task-3"] as const;
    const smallSnapshot = { text: "x".repeat(200) };

    queryClient.setQueryData(firstKey, smallSnapshot);
    queryClient.setQueryData(updatedKey, smallSnapshot);
    queryClient.setQueryData(updatedKey, { text: "x".repeat(2048) });

    expect(queryClient.getQueryCache().find({ exact: true, queryKey: updatedKey })).toBeUndefined();
    expect(queryClient.getQueryData(firstKey)).toEqual(smallSnapshot);

    queryClient.setQueryData(nextKey, smallSnapshot);
    expect(queryClient.getQueryData(firstKey)).toEqual(smallSnapshot);
    expect(queryClient.getQueryData(nextKey)).toEqual(smallSnapshot);
  });

  it("retains an oversized observed snapshot until its last observer unsubscribes", () => {
    uninstall = installInactiveSnapshotMemoryLimit(queryClient, 1024, 12);
    const queryKey = ["projects", "project-1", "tasks", "task-1"] as const;
    const snapshot = { text: "x".repeat(2048) };
    const firstObserver = new QueryObserver(queryClient, { queryKey, enabled: false });
    const secondObserver = new QueryObserver(queryClient, { queryKey, enabled: false });
    const unsubscribeFirst = firstObserver.subscribe(vi.fn());
    const unsubscribeSecond = secondObserver.subscribe(vi.fn());

    try {
      queryClient.setQueryData(queryKey, snapshot);
      expect(queryClient.getQueryData(queryKey)).toEqual(snapshot);

      unsubscribeFirst();
      expect(queryClient.getQueryData(queryKey)).toEqual(snapshot);

      unsubscribeSecond();
      expect(queryClient.getQueryCache().find({ exact: true, queryKey })).toBeUndefined();
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it.each([
    { maxBytes: 0, maxEntries: 12 },
    { maxBytes: 1024, maxEntries: 0 },
  ])("removes inactive snapshots with limits $maxBytes bytes / $maxEntries entries", (limits) => {
    uninstall = installInactiveSnapshotMemoryLimit(
      queryClient,
      limits.maxBytes,
      limits.maxEntries,
    );
    const queryKey = ["projects", "project-1", "tasks", "task-1"] as const;

    queryClient.setQueryData(queryKey, { text: "正文" });

    expect(queryClient.getQueryCache().find({ exact: true, queryKey })).toBeUndefined();
  });

  it("does not apply the snapshot budget to unrelated queries", () => {
    uninstall = installInactiveSnapshotMemoryLimit(queryClient, 0, 0);

    queryClient.setQueryData(["projects"], { text: "保留" });

    expect(queryClient.getQueryData(["projects"])).toEqual({ text: "保留" });
  });
});
