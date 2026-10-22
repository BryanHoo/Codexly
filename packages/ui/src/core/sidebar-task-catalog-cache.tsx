import type { AgentTask } from "@codexly/protocol";

// 只约束所需方法，避免两端 NodeNext/Bundler 的 QueryClient 私有类型跨包耦合。
interface CatalogCacheClient {
  cancelQueries(filters: { exact: boolean; queryKey: readonly unknown[] }): Promise<unknown>;
  invalidateQueries(filters: { exact: boolean; queryKey: readonly unknown[] }): Promise<unknown>;
  getQueryData(key: readonly unknown[]): unknown;
  setQueryData<T>(
    key: readonly unknown[],
    updater: (current: T | undefined) => T | undefined,
  ): unknown;
}

/** 仅更新已存在的完整目录；取消旧读取，防止迟到响应覆盖已确认的任务操作。 */
export function patchSidebarTaskCatalog(
  client: CatalogCacheClient,
  projectId: string,
  update: (tasks: readonly AgentTask[]) => readonly AgentTask[],
): void {
  invalidateSidebarTimelineRecent(client, projectId);
  const queryKey = ["projects", projectId, "tasks", "search-source"];
  void client.cancelQueries({ exact: true, queryKey });
  client.setQueryData<readonly AgentTask[]>(queryKey, (tasks) =>
    tasks === undefined ? undefined : update(tasks),
  );
  // 首次目录尚未返回时不能构造局部数据；重新启动活动查询，避免取消后永久停留在加载中。
  if (client.getQueryData(queryKey) === undefined)
    void client.invalidateQueries({ exact: true, queryKey });
}

/** 近期查询与完整目录分开缓存；写操作后只校准已启用的近期观察器，不提前读取历史。 */
export function invalidateSidebarTimelineRecent(
  client: CatalogCacheClient,
  projectId: string,
): void {
  const queryKey = ["projects", projectId, "tasks", "timeline-recent"];
  void client.cancelQueries({ exact: false, queryKey });
  void client.invalidateQueries({ exact: false, queryKey });
}

export function upsertSidebarTaskCatalog(client: CatalogCacheClient, task: AgentTask): void {
  patchSidebarTaskCatalog(client, task.projectId, (tasks) => [
    task,
    ...tasks.filter((current) => current.id !== task.id),
  ]);
}
