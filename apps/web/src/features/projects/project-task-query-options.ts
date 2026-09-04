import type { AgentTaskPage } from "@codexly/protocol";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  PROJECT_TASK_PAGE_SIZE,
  COMPLETED_TASK_PAGE_SIZE,
  ARCHIVED_TASK_PAGE_SIZE,
  TASK_SNAPSHOT_GC_TIME_MS,
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

export function completedTasksInfiniteQueryOptions(
  projectIds: readonly string[],
  client: CodexlyReadClient = codexlyClient,
) {
  return infiniteQueryOptions<
    CompletedTasksPage,
    Error,
    CompletedTasksInfiniteData,
    readonly ["task-board", "completed", readonly string[]],
    CompletedTasksCursor | undefined
  >({
    getNextPageParam: (lastPage) =>
      Object.values(lastPage.cursors).some((cursor) => cursor !== null)
        ? lastPage.cursors
        : undefined,
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const activeProjectIds = projectIds.filter(
        (projectId) => pageParam === undefined || pageParam[projectId] !== null,
      );
      const perProjectLimit = Math.max(
        1,
        Math.ceil(COMPLETED_TASK_PAGE_SIZE / Math.max(1, activeProjectIds.length)),
      );
      // 各项目独立维护游标并发拉取，避免项目数量线性放大看板等待时间。
      const pages = await Promise.all(
        activeProjectIds.map(async (projectId) => ({
          page: await client.listTasks(
            projectId,
            {
              completed: true,
              ...(typeof pageParam?.[projectId] === "string"
                ? { cursor: pageParam[projectId] }
                : {}),
              limit: perProjectLimit,
            },
            { signal },
          ),
          projectId,
        })),
      );
      const cursors: Record<string, string | null> = { ...(pageParam ?? {}) };
      for (const { page, projectId } of pages) cursors[projectId] = page.nextCursor;
      return {
        cursors,
        data: pages
          .flatMap(({ page }) => page.data)
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
      };
    },
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
