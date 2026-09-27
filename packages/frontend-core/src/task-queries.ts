export const PROJECT_TASK_PAGE_SIZE = 5;
export const ARCHIVED_TASK_PAGE_SIZE = 20;
export const PROJECT_PINNED_TASKS_KEY = "pinned";
export const TASK_BOARD_COMPLETED_TASKS_QUERY_KEY = ["task-board", "completed"] as const;
export const TASK_SNAPSHOT_GC_TIME_MS = 30_000;

export const taskQueueQueryKey = (projectId: string, taskId: string) =>
  ["projects", projectId, "tasks", taskId, "queue"] as const;

export function archivedProjectTasksQueryOptions<Page>(
  projectId: string,
  cursor: string | undefined,
  searchTerm: string,
  read: (signal: AbortSignal) => Promise<Page>,
) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) => read(signal),
    queryKey: ["projects", projectId, "archived-tasks", searchTerm, cursor ?? null] as const,
    refetchOnMount: "always" as const,
  };
}

export function projectTasksInfiniteQueryOptions<Page extends { nextCursor: string | null }>(
  projectId: string,
  read: (cursor: string | undefined, signal: AbortSignal) => Promise<Page>,
) {
  return {
    getNextPageParam: (lastPage: Page, _pages: readonly Page[], lastCursor: string | undefined) =>
      lastPage.nextCursor === null || lastPage.nextCursor === lastCursor
        ? undefined
        : lastPage.nextCursor,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      read(pageParam, signal),
    queryKey: ["projects", projectId, "tasks"] as const,
  };
}

export function taskSnapshotQueryOptions<Snapshot>(
  projectId: string,
  taskId: string,
  read: (signal: AbortSignal) => Promise<Snapshot>,
) {
  return {
    gcTime: TASK_SNAPSHOT_GC_TIME_MS,
    queryFn: ({ signal }: { signal: AbortSignal }) => read(signal),
    queryKey: ["projects", projectId, "tasks", taskId] as const,
  };
}
