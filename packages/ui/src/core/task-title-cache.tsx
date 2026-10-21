// 只依赖目录投影所需的方法，避免 NodeNext 与 Bundler 导出的 QueryClient 私有类型跨包耦合。
interface TaskTitleCacheClient {
  setQueriesData<T>(
    filters: { predicate: (query: { queryKey: readonly unknown[] }) => boolean },
    updater: (current: T | undefined) => T | undefined,
  ): unknown;
}

type TaskTitle = Readonly<{ id: string; projectId: string; title: string }>;

/** 标题通知只改目录投影，不创建缺失缓存，也不改聊天快照的覆盖 checkpoint。 */
export function patchTaskTitleCaches(
  client: TaskTitleCacheClient,
  projectId: string,
  taskId: string,
  title: string,
): void {
  const patchTasks = (tasks: readonly TaskTitle[]) => {
    const next = tasks.map((task) => {
      if (task.id !== taskId || task.projectId !== projectId || task.title === title) return task;
      return { ...task, title };
    });
    return next.some((task, index) => task !== tasks[index]) ? next : tasks;
  };
  client.setQueriesData<
    readonly TaskTitle[] | { pages: readonly { data: readonly TaskTitle[] }[] }
  >(
    {
      predicate: ({ queryKey: key }) =>
        (key[0] === "projects" &&
          key[1] === projectId &&
          key[2] === "tasks" &&
          (key.length === 3 || key[3] === "pinned" || key[3] === "search-source")) ||
        (key[0] === "task-board" && key[1] === "completed"),
    },
    (current) => {
      if (!current) return current;
      if (Array.isArray(current)) return patchTasks(current);
      const paginated = current as { pages: readonly { data: readonly TaskTitle[] }[] };
      const pages = paginated.pages.map((page) => {
        const data = patchTasks(page.data);
        if (data === page.data) return page;
        return { ...page, data };
      });
      return pages.some((page, index) => page !== paginated.pages[index])
        ? { ...paginated, pages }
        : current;
    },
  );
}
