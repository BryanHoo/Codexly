import type { AgentTaskPage } from "@code-agent/protocol";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  PROJECT_TASK_PAGE_SIZE,
  ARCHIVED_TASK_PAGE_SIZE,
  TASK_SNAPSHOT_GC_TIME_MS,
  codeAgentClient,
  type CodeAgentReadClient,
  type CodeAgentArchivedTaskClient,
  type CodeAgentSnapshotClient,
  type ProjectTaskInfiniteData,
} from "./project-query-contracts.js";

export function archivedProjectTasksQueryOptions(
  projectId: string,
  cursor: string | undefined,
  searchTerm: string,
  client: CodeAgentArchivedTaskClient = codeAgentClient,
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
  client: CodeAgentReadClient = codeAgentClient,
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
  client: CodeAgentSnapshotClient = codeAgentClient,
) {
  return queryOptions({
    gcTime: TASK_SNAPSHOT_GC_TIME_MS,
    queryFn: ({ signal }) => client.readTask(projectId, taskId, { signal }),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  });
}
