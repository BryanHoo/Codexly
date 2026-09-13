import { describe, expect, it, vi } from "vitest";

import {
  archivedProjectTasksQueryOptions,
  completedTasksInfiniteQueryOptions,
} from "./project-task-query-options.js";

describe("archivedProjectTasksQueryOptions", () => {
  it("always refetches archived tasks when the dialog mounts", () => {
    const queryOptions = archivedProjectTasksQueryOptions("codexly", undefined, "");

    expect(queryOptions.refetchOnMount).toBe("always");
  });
});

describe("completedTasksInfiniteQueryOptions", () => {
  it("每页只发送一次聚合查询并原样传递游标和取消信号", async () => {
    const cursor = { "project-a": "next-a", "project-b": null };
    const client = {
      queryCompletedTasks: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    };
    const options = completedTasksInfiniteQueryOptions(["project-a", "project-b"], client);

    const signal = new AbortController().signal;
    const page = await options.queryFn?.({ pageParam: cursor, signal } as never);
    expect(client.queryCompletedTasks).toHaveBeenCalledExactlyOnceWith(
      { projectIds: ["project-a", "project-b"], cursor },
      { signal },
    );
    expect(page).toEqual({ data: [], nextCursor: null });
  });
});
