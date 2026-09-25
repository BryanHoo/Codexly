import type { AgentTaskPage } from "@/protocol/index.js";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  ARCHIVED_TASK_PAGE_SIZE,
  COMPLETED_TASK_PAGE_SIZE,
  PROJECT_TASK_PAGE_SIZE,
  TASK_SNAPSHOT_GC_TIME_MS,
  TASK_BOARD_COMPLETED_TASKS_QUERY_KEY,
  nativeClient,
  type NativeReadClient,
  type NativeArchivedTaskClient,
  type NativeSnapshotClient,
  type ProjectTaskInfiniteData,
} from "./project-query-contracts.js";

export function archivedProjectTasksQueryOptions(
  projectId: string,
  cursor: string | undefined,
  searchTerm: string,
  client: NativeArchivedTaskClient = nativeClient,
) {
  return queryOptions({
    queryFn: ({ signal }) =>
      client.listTasks(
        projectId,
        {
          archived: true,
          ...(cursor === undefined ? {} : { cursor }),
          limit: ARCHIVED_TASK_PAGE_SIZE,
          ...(searchTerm.length === 0 ? {} : { searchTerm }),
        },
        { signal },
      ),
    queryKey: ["projects", projectId, "archived-tasks", searchTerm, cursor ?? null] as const,
    // 归档内容可能刚由侧栏 Mutation 改变，弹窗每次打开都绕过全局新鲜期重新校准。
    refetchOnMount: "always",
  });
}

export function projectTasksInfiniteQueryOptions(
  projectId: string,
  client: NativeReadClient = nativeClient,
) {
  return infiniteQueryOptions<
    AgentTaskPage,
    Error,
    ProjectTaskInfiniteData,
    readonly ["projects", string, "tasks"],
    string | undefined
  >({
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.nextCursor === null || lastPage.nextCursor === lastPageParam
        ? undefined
        : lastPage.nextCursor,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      client.listTasks(
        projectId,
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          limit: PROJECT_TASK_PAGE_SIZE,
        },
        { signal },
      ),
    queryKey: ["projects", projectId, "tasks"] as const,
  });
}

export function completedTasksInfiniteQueryOptions(
  projectId: string | null,
  client: NativeReadClient = nativeClient,
) {
  return infiniteQueryOptions<
    AgentTaskPage,
    Error,
    ProjectTaskInfiniteData,
    readonly ["task-board", "completed", string | null],
    string | undefined
  >({
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.nextCursor === null || lastPage.nextCursor === lastPageParam
        ? undefined
        : lastPage.nextCursor,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      client.listCompletedTasks(
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          limit: COMPLETED_TASK_PAGE_SIZE,
          ...(projectId === null ? {} : { projectId }),
        },
        { signal },
      ),
    queryKey: [...TASK_BOARD_COMPLETED_TASKS_QUERY_KEY, projectId] as const,
  });
}

export function taskSnapshotQueryOptions(
  projectId: string,
  taskId: string,
  client: NativeSnapshotClient = nativeClient,
) {
  return queryOptions({
    gcTime: TASK_SNAPSHOT_GC_TIME_MS,
    queryFn: ({ signal }) => client.readTask(projectId, taskId, { signal }),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  });
}
