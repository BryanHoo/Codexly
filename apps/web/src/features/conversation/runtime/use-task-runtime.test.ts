import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { snapshotResponse } from "../../projects/project-queries.test-support.js";
import { createTaskStore } from "./task-store.js";
import {
  consumeTaskSnapshotQuery,
  deriveTaskRuntimePending,
  selectActiveTaskStore,
} from "./use-task-runtime.js";

describe("consumeTaskSnapshotQuery", () => {
  it("transfers a cached snapshot response out of React Query", () => {
    const queryClient = new QueryClient();
    const queryKey = ["projects", "codexly", "tasks", "task-1"] as const;
    queryClient.setQueryData(queryKey, snapshotResponse);

    expect(consumeTaskSnapshotQuery(queryClient, queryKey)).toBe(snapshotResponse);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });
});

describe("selectActiveTaskStore", () => {
  it("isolates retained normalized stores by project and task identity", () => {
    const store = createTaskStore({ projectId: "codexly", taskId: "task-1" });

    expect(selectActiveTaskStore(store, "other-project", "task-1")).toBeUndefined();
    expect(selectActiveTaskStore(store, "codexly", "task-other")).toBeUndefined();
    expect(selectActiveTaskStore(store, "codexly", "task-1")).toBe(store);
  });
});

describe("deriveTaskRuntimePending", () => {
  it("keeps a retained hydrated task usable while its snapshot revalidates", () => {
    expect(
      deriveTaskRuntimePending({
        error: null,
        hasActiveRuntime: true,
        hasHydratedSnapshot: true,
        snapshotPending: true,
      }),
    ).toBe(false);
  });

  it("blocks a cold task until its first snapshot is hydrated", () => {
    expect(
      deriveTaskRuntimePending({
        error: null,
        hasActiveRuntime: true,
        hasHydratedSnapshot: false,
        snapshotPending: true,
      }),
    ).toBe(true);
  });
});
