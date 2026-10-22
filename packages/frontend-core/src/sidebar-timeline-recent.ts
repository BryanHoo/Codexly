import type { AgentTask, AgentTaskPage } from "@codexly/protocol";

export type SidebarTimelineRecent = Readonly<{
  tasks: readonly AgentTask[];
  hasEarlier: boolean;
  earlierCount: number | null;
}>;

/** 页面按更新时间降序；遇到历史边界立即停读，不能为计算总数追踪更早的游标。 */
export async function loadSidebarTimelineRecent(
  loadPage: (cursor: string | undefined) => Promise<AgentTaskPage>,
  since: number,
): Promise<SidebarTimelineRecent> {
  const tasks = new Map<string, AgentTask>();
  const earlier = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (cursors.size >= 1000 || tasks.size > 10000)
      throw Error("Recent task pagination exceeds the limit");
    const page = await loadPage(cursor);
    for (const task of page.data) {
      if (Date.parse(task.updatedAt) >= since) {
        if (!tasks.has(task.id)) tasks.set(task.id, task);
      } else earlier.add(task.id);
    }
    if (page.nextCursor === null || earlier.size > 0)
      return {
        tasks: [...tasks.values()],
        hasEarlier: earlier.size > 0,
        earlierCount: page.nextCursor === null ? earlier.size : null,
      };
    if (cursors.has(page.nextCursor))
      throw Error("Recent task pagination returned a repeated cursor");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
