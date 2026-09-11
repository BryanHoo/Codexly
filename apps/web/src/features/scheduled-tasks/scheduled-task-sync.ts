import type { CodexlyClient } from "@codexly/client";
import type { ScheduledTaskPage } from "@codexly/protocol";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

export const scheduledTasksQueryKey = ["scheduled-tasks"] as const;

export async function refreshScheduledTaskLists(
  queryClient: QueryClient,
  previous: ScheduledTaskPage | undefined,
  current: ScheduledTaskPage,
) {
  const known = new Set(previous?.data.flatMap((task) => task.runs.map((run) => run.taskId)));
  // 启动记录先出现、taskId 后补齐；只在发现新的实际任务时刷新所属项目。
  const projects = new Set(
    current.data
      .filter((task) => task.runs.some((run) => run.taskId !== null && !known.has(run.taskId)))
      .map((task) => task.projectId),
  );
  if (projects.size === 0) return;
  // 多项目同时到期也只扫描一次查询缓存，不逐项目遍历全部缓存。
  await queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === "projects" &&
      typeof queryKey[1] === "string" &&
      projects.has(queryKey[1]) &&
      queryKey[2] === "tasks" &&
      (queryKey.length === 3 || queryKey[3] === "pinned" || queryKey[3] === "search-source"),
  });
}

export function scheduledTasksQueryOptions(
  client: Pick<CodexlyClient, "listScheduledTasks">,
  queryClient: QueryClient,
) {
  return queryOptions({
    queryKey: scheduledTasksQueryKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<ScheduledTaskPage>(scheduledTasksQueryKey);
      const current = await client.listScheduledTasks({ signal });
      await refreshScheduledTaskLists(queryClient, previous, current);
      return current;
    },
  });
}
