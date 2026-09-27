import type { AgentTaskPage } from "@/protocol/index.js";
import { archivedProjectTasksQueryOptions as sharedArchivedTasks, projectTasksInfiniteQueryOptions as sharedProjectTasks, taskSnapshotQueryOptions as sharedTaskSnapshot } from "@codexly/frontend-core";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  ARCHIVED_TASK_PAGE_SIZE,
  COMPLETED_TASK_PAGE_SIZE,
  PROJECT_TASK_PAGE_SIZE,
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
  return queryOptions(sharedArchivedTasks(projectId, cursor, searchTerm, (signal) =>
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
  ));
}

export function projectTasksInfiniteQueryOptions(
  projectId: string,
  client: NativeReadClient = nativeClient,
) {
  return infiniteQueryOptions<AgentTaskPage, Error, ProjectTaskInfiniteData, readonly ["projects", string, "tasks"], string | undefined>(sharedProjectTasks(projectId, (pageParam, signal) =>
    client.listTasks(
        projectId,
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          limit: PROJECT_TASK_PAGE_SIZE,
        },
        { signal },
      ),
  ));
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
  return queryOptions(sharedTaskSnapshot(projectId, taskId, (signal) => client.readTask(projectId, taskId, { signal })));
}
