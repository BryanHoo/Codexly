import type { AgentTaskPage } from "@codexly/protocol";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  PROJECT_TASK_PAGE_SIZE,
  ARCHIVED_TASK_PAGE_SIZE,
  TASK_SNAPSHOT_GC_TIME_MS,
  codexlyClient,
  type CodexlyReadClient,
  type CodexlyArchivedTaskClient,
  type CodexlySnapshotClient,
  type ProjectTaskInfiniteData,
} from "./project-query-contracts.js";

export function archivedProjectTasksQueryOptions(
  projectId: string,
  cursor: string | undefined,
  searchTerm: string,
  client: CodexlyArchivedTaskClient = codexlyClient,
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
  });
}

export function projectTasksInfiniteQueryOptions(
  projectId: string,
  client: CodexlyReadClient = codexlyClient,
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

export function taskSnapshotQueryOptions(
  projectId: string,
  taskId: string,
  client: CodexlySnapshotClient = codexlyClient,
) {
  return queryOptions({
    gcTime: TASK_SNAPSHOT_GC_TIME_MS,
    queryFn: ({ signal }) => client.readTask(projectId, taskId, { signal }),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  });
}
