import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  type CodeAgentReadClient,
  listProjectTasksForSearch,
  listPinnedProjectTasks,
  projectTasksInfiniteQueryOptions,
  removeArchivedProjectTaskAndRefill,
  flattenProjectTaskPages,
} from "./project-queries.js";
import { project, task, snapshotResponse } from "./project-queries.test-support.js";

describe("project pagination queries", () => {
  it("loads only the first task page until the next page is explicitly requested", async () => {
    const nextTask = { ...task, id: "task-2", title: "后续分页任务" };
    const listTasks = vi
      .fn<CodeAgentReadClient["listTasks"]>()
      .mockResolvedValueOnce({ data: [task], nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: [nextTask], nextCursor: null });
    const client = {
      listProjects: vi.fn(() => Promise.resolve({ data: [project], nextCursor: null })),
      listTasks,
      readTask: vi.fn(() => Promise.resolve(snapshotResponse)),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const queryOptions = projectTasksInfiniteQueryOptions("code-agent", client);
    const queryObserver = new InfiniteQueryObserver(queryClient, queryOptions);
    const unsubscribe = queryObserver.subscribe(() => undefined);

    await expect(queryObserver.refetch()).resolves.toMatchObject({
      data: {
        pageParams: [undefined],
        pages: [{ data: [task], nextCursor: "next-page" }],
      },
    });
    expect(queryClient.getQueryData(queryOptions.queryKey)).toEqual({
      pageParams: [undefined],
      pages: [{ data: [task], nextCursor: "next-page" }],
    });
    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(listTasks.mock.calls[0]?.slice(0, 2)).toEqual(["code-agent", { limit: 5 }]);
    expect(listTasks.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);

    await expect(queryObserver.fetchNextPage()).resolves.toMatchObject({
      data: {
        pageParams: [undefined, "next-page"],
        pages: [
          { data: [task], nextCursor: "next-page" },
          { data: [nextTask], nextCursor: null },
        ],
      },
    });
    expect(listTasks.mock.calls[1]?.slice(0, 2)).toEqual([
      "code-agent",
      {
        cursor: "next-page",
        limit: 5,
      },
    ]);
    expect(listTasks.mock.calls[1]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    unsubscribe();
  });

  it("loads every task page for search and removes overlapping tasks", async () => {
    const secondTask = { ...task, id: "task-2", title: "完整搜索结果" };
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ data: [task], nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: [task, secondTask], nextCursor: null });

    await expect(listProjectTasksForSearch("code-agent", { listTasks })).resolves.toEqual([
      task,
      secondTask,
    ]);
    expect(listTasks).toHaveBeenNthCalledWith(1, "code-agent", { limit: 100 });
    expect(listTasks).toHaveBeenNthCalledWith(2, "code-agent", {
      cursor: "next-page",
      limit: 100,
    });
  });

  it("loads only pinned tasks across every pinned page", async () => {
    const secondTask = { ...task, id: "task-2", pinned: true, title: "较早固定任务" };
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ ...task, pinned: true }], nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: [secondTask], nextCursor: null });

    await expect(listPinnedProjectTasks("code-agent", { listTasks })).resolves.toEqual([
      { ...task, pinned: true },
      secondTask,
    ]);
    expect(listTasks).toHaveBeenNthCalledWith(1, "code-agent", { limit: 100, pinned: true });
    expect(listTasks).toHaveBeenNthCalledWith(2, "code-agent", {
      cursor: "next-page",
      limit: 100,
      pinned: true,
    });
  });

  it("refetches the active first page after archive to keep five recent tasks visible", async () => {
    const initialTasks = Array.from({ length: 5 }, (_, index) => ({
      ...task,
      id: `task-${String(index + 1)}`,
      title: `Task ${String(index + 1)}`,
    }));
    const replenishedTasks = [...initialTasks.slice(1), { ...task, id: "task-6", title: "Task 6" }];
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ data: initialTasks, nextCursor: "next-page" })
      .mockResolvedValueOnce({ data: replenishedTasks, nextCursor: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryOptions = projectTasksInfiniteQueryOptions("code-agent", {
      listProjects: vi.fn(),
      listTasks,
      readTask: vi.fn(),
    });
    const queryObserver = new InfiniteQueryObserver(queryClient, queryOptions);
    const unsubscribe = queryObserver.subscribe(() => undefined);
    await queryObserver.refetch();
    queryClient.setQueryData(["projects", "code-agent", "tasks", "search-source"], initialTasks);

    await removeArchivedProjectTaskAndRefill(queryClient, "code-agent", "task-1");

    expect(flattenProjectTaskPages(queryClient.getQueryData(queryOptions.queryKey))).toEqual(
      replenishedTasks,
    );
    expect(queryClient.getQueryData(["projects", "code-agent", "tasks", "search-source"])).toEqual(
      initialTasks.slice(1),
    );
    expect(listTasks).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
