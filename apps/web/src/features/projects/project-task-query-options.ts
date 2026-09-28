import type { CodexlyClient } from "@codexly/client";
import {
  archivedProjectTasksQueryOptions as sharedArchivedTasks,
  projectTasksInfiniteQueryOptions as sharedProjectTasks,
  taskSnapshotQueryOptions as sharedTaskSnapshot,
} from "@codexly/frontend-core";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { AgentTaskPage } from "@codexly/protocol";

import {
  ARCHIVED_TASK_PAGE_SIZE,
  PROJECT_TASK_PAGE_SIZE,
  TASK_BOARD_COMPLETED_TASKS_QUERY_KEY,
  codexlyClient,
  type CodexlyReadClient,
  type CodexlyArchivedTaskClient,
  type CodexlySnapshotClient,
  type CompletedTasksCursor,
  type CompletedTasksInfiniteData,
  type CompletedTasksPage,
  type ProjectTaskInfiniteData,
} from "./project-query-contracts.js";

export function archivedProjectTasksQueryOptions(
  projectId: string,
  cursor: string | undefined,
  searchTerm: string,
  client: CodexlyArchivedTaskClient = codexlyClient,
) {
  return queryOptions(
    sharedArchivedTasks(projectId, cursor, searchTerm, (signal) =>
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
    ),
  );
}

export function completedTasksInfiniteQueryOptions(
  projectIds: readonly string[],
  client: Pick<CodexlyClient, "queryCompletedTasks"> = codexlyClient,
) {
  return infiniteQueryOptions<
    CompletedTasksPage,
    Error,
    CompletedTasksInfiniteData,
    readonly ["task-board", "completed", readonly string[]],
    CompletedTasksCursor | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      client.queryCompletedTasks(
        { projectIds, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
        { signal },
      ),
    queryKey: [...TASK_BOARD_COMPLETED_TASKS_QUERY_KEY, projectIds] as const,
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
  >(
    sharedProjectTasks(projectId, (pageParam, signal) =>
      client.listTasks(
        projectId,
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          limit: PROJECT_TASK_PAGE_SIZE,
        },
        { signal },
      ),
    ),
  );
}

export function taskSnapshotQueryOptions(
  projectId: string,
  taskId: string,
  client: CodexlySnapshotClient = codexlyClient,
) {
  return queryOptions(
    sharedTaskSnapshot(projectId, taskId, (signal) =>
      client.readTask(projectId, taskId, { signal }),
    ),
  );
}
