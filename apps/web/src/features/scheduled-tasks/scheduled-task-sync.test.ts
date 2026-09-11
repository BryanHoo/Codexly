import { QueryClient } from "@tanstack/react-query";
import type { ScheduledTaskPage } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { refreshScheduledTaskLists } from "./scheduled-task-sync.js";

describe("scheduled task sidebar sync", () => {
  it("invalidates the project list when a running launch receives its task id", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects", "temporary", "tasks"], { pages: [] });
    queryClient.setQueryData(["projects", "other", "tasks"], { pages: [] });
    const before = {
      data: [{ projectId: "temporary", runs: [{ id: "run", taskId: null }] }],
    } as unknown as ScheduledTaskPage;
    const after = {
      data: [{ projectId: "temporary", runs: [{ id: "run", taskId: "created" }] }],
    } as unknown as ScheduledTaskPage;
    await refreshScheduledTaskLists(queryClient, before, after);
    expect(queryClient.getQueryState(["projects", "temporary", "tasks"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["projects", "other", "tasks"])?.isInvalidated).toBe(false);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await refreshScheduledTaskLists(queryClient, after, after);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
