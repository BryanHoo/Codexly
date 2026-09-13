import type { AgentTask, AgentTaskCatalog } from "@codexly/protocol";
import type { AgentProvider } from "./agent-provider.js";

/** 完整搜索源和置顶目录共用分页规则，不把不完整结果伪装成完整目录。 */
export async function listTaskCatalog(
  provider: Pick<AgentProvider, "listTasks">,
  scopeId: string,
  options: Readonly<{ pinned?: true }> = {},
): Promise<AgentTaskCatalog> {
  const tasks = new Map<string, AgentTask>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (cursors.size >= 1000) throw new Error("Task catalog pagination exceeds the page limit");
    const page = await provider.listTasks({
      limit: 100,
      ...(options.pinned === true ? { pinnedOnly: true } : {}),
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const task of page.data) {
      if (task.projectId !== scopeId) throw new Error("Task catalog crossed its scope");
      // 分页边界重叠时保留首次出现的较新版本及原始顺序。
      if (!tasks.has(task.id)) tasks.set(task.id, task);
      if (tasks.size > 10000) throw new Error("Task catalog exceeds the 10000 task limit");
    }
    if (page.nextCursor === null) return { data: [...tasks.values()] };
    if (cursors.has(page.nextCursor)) throw new Error("Task catalog returned a repeated cursor");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
