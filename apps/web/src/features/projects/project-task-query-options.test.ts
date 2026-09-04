import { describe, expect, it } from "vitest";

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
  it("并发读取项目并保留各自下一页游标", async () => {
    const calls: { completed?: true; cursor?: string; limit?: number; projectId: string }[] = [];
    const client = {
      listTasks: (
        projectId: string,
        options: { completed?: true; cursor?: string; limit?: number },
      ) => {
        calls.push({ projectId, ...options });
        return Promise.resolve({
          data: [],
          nextCursor: projectId === "project-a" ? "next-a" : null,
        });
      },
    };
    const options = completedTasksInfiniteQueryOptions(["project-a", "project-b"], client as never);

    const page = await options.queryFn?.({
      pageParam: undefined,
      signal: new AbortController().signal,
    } as never);

    expect(calls).toEqual([
      { completed: true, limit: 5, projectId: "project-a" },
      { completed: true, limit: 5, projectId: "project-b" },
    ]);
    expect(page).toMatchObject({ cursors: { "project-a": "next-a", "project-b": null } });
  });
});
