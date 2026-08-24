import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { installInactiveSnapshotMemoryLimit } from "./snapshot-memory.js";

describe("installInactiveSnapshotMemoryLimit", () => {
  it("evicts least-recently-updated inactive task snapshots by bytes", () => {
    const queryClient = new QueryClient();
    const uninstall = installInactiveSnapshotMemoryLimit(queryClient, 700, 10);
    const firstKey = ["projects", "project-1", "tasks", "task-1"] as const;
    const secondKey = ["projects", "project-1", "tasks", "task-2"] as const;

    queryClient.setQueryData(firstKey, { snapshot: { text: "一".repeat(100) } });
    queryClient.setQueryData(secondKey, { snapshot: { text: "二".repeat(100) } });

    expect(queryClient.getQueryData(firstKey)).toBeUndefined();
    expect(queryClient.getQueryData(secondKey)).toBeDefined();
    uninstall();
  });

  it("does not apply the snapshot budget to unrelated queries", () => {
    const queryClient = new QueryClient();
    const uninstall = installInactiveSnapshotMemoryLimit(queryClient, 0, 0);

    queryClient.setQueryData(["projects"], { text: "保留" });

    expect(queryClient.getQueryData(["projects"])).toEqual({ text: "保留" });
    uninstall();
  });
});
