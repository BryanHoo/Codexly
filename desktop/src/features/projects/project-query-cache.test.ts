import type { AgentTask, AgentTaskPage } from "@/protocol/index.js";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  cacheCompletedProjectTask,
  cacheCreatedProjectTask,
  refreshStartedProjectTask,
} from "./project-query-cache.js";

const existingTask: AgentTask = {
  id: "task-existing",
  pinned: false,
  projectId: "project-a",
  title: "已有任务",
  updatedAt: "2026-09-02T00:00:00Z",
};

const createdTask: AgentTask = {
  id: "task-created",
  pinned: false,
  projectId: "project-a",
  title: "新建任务",
  updatedAt: "2026-09-02T00:01:00Z",
};

describe("cacheCreatedProjectTask", () => {
  it("keeps the created task when an older task-list request finishes later", async () => {
    const queryClient = new QueryClient();
    let resolveStalePage: (page: AgentTaskPage) => void = () => undefined;
    let markRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const stalePage = new Promise<AgentTaskPage>((resolve) => {
      resolveStalePage = resolve;
    });
    const queryKey = ["projects", createdTask.projectId, "tasks"] as const;
    const staleFetch = queryClient.fetchInfiniteQuery({
      getNextPageParam: () => undefined,
      initialPageParam: undefined,
      queryFn: () => {
        markRequestStarted();
        return stalePage;
      },
      queryKey,
    });

    await requestStarted;
    await cacheCreatedProjectTask(queryClient, createdTask);
    resolveStalePage({ data: [existingTask], nextCursor: null });
    await Promise.allSettled([staleFetch]);

    expect(queryClient.getQueryData(queryKey)).toEqual({
      pageParams: [undefined],
      pages: [{ data: [createdTask], nextCursor: null }],
    });
  });
});

describe("cacheCompletedProjectTask", () => {
  it("immediately inserts a completed task into matching board caches", async () => {
    const queryClient = new QueryClient();
    const allProjectsKey = ["task-board", "completed", null] as const;
    const currentProjectKey = ["task-board", "completed", "project-a"] as const;
    const otherProjectKey = ["task-board", "completed", "project-b"] as const;
    const currentData = {
      pageParams: [undefined],
      pages: [{ data: [existingTask], nextCursor: null }],
    };

    queryClient.setQueryData(allProjectsKey, currentData);
    queryClient.setQueryData(currentProjectKey, currentData);
    queryClient.setQueryData(otherProjectKey, currentData);

    await cacheCompletedProjectTask(queryClient, createdTask);

    expect(queryClient.getQueryData(allProjectsKey)).toEqual({
      pageParams: [undefined],
      pages: [{ data: [createdTask, existingTask], nextCursor: null }],
    });
    expect(queryClient.getQueryData(currentProjectKey)).toEqual({
      pageParams: [undefined],
      pages: [{ data: [createdTask, existingTask], nextCursor: null }],
    });
    expect(queryClient.getQueryData(otherProjectKey)).toEqual(currentData);
  });
});

describe("refreshStartedProjectTask", () => {
  it("moves a task from a later page to the front without duplicating it", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["projects", "project-a", "tasks"] as const;
    const laterTask = { ...existingTask, id: "task-later", title: "后页任务" };
    queryClient.setQueryData(queryKey, {
      pageParams: [undefined, "cursor-2", "cursor-3"],
      pages: [
        { data: [createdTask], nextCursor: "cursor-2" },
        { data: [existingTask], nextCursor: "cursor-3" },
        { data: [laterTask], nextCursor: null },
      ],
    });

    await refreshStartedProjectTask(
      queryClient,
      "project-a",
      "task-later",
      "2026-09-03T08:00:00.000Z",
    );

    const data = queryClient.getQueryData<{ pages: AgentTaskPage[] }>(queryKey);
    expect(data?.pages[0]?.data[0]).toEqual({
      ...laterTask,
      updatedAt: "2026-09-03T08:00:00.000Z",
    });
    expect(data?.pages.flatMap((page) => page.data).filter((task) => task.id === laterTask.id)).toHaveLength(1);
  });

  it("keeps a newly created task when the started-task refresh returns an older list", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["projects", "project-a", "tasks"] as const;
    const currentData = {
      pageParams: [undefined],
      pages: [{ data: [createdTask, existingTask], nextCursor: null }],
    };
    const staleData = {
      pageParams: [undefined],
      pages: [{ data: [existingTask], nextCursor: null }],
    };
    queryClient.setQueryData(queryKey, currentData);
    const observer = new QueryObserver(queryClient, {
      queryFn: async () => staleData,
      queryKey,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await refreshStartedProjectTask(
      queryClient,
      "project-a",
      createdTask.id,
      "2026-09-03T08:00:00.000Z",
    );

    const data = queryClient.getQueryData<{ pages: AgentTaskPage[] }>(queryKey);
    expect(data?.pages[0]?.data[0]).toEqual({
      ...createdTask,
      updatedAt: "2026-09-03T08:00:00.000Z",
    });
    unsubscribe();
  });
});
