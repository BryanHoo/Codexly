import type { DeleteArchivedTasksRequest } from "@codexly/protocol";
import type { AgentProvider } from "./agent-provider.js";

type ArchivedTaskProvider = Pick<
  AgentProvider,
  "listTasks" | "readTask" | "readTaskMetadata" | "deleteTask"
>;

/** 先固定目标集合，再执行删除，避免分页游标因本次删除而跳过任务。 */
export async function deleteArchivedTasks(
  provider: ArchivedTaskProvider,
  scopeId: string,
  options: DeleteArchivedTasksRequest = {},
) {
  const cutoff =
    options.updatedBefore === undefined ? undefined : Date.parse(options.updatedBefore);
  if (cutoff !== undefined && !Number.isFinite(cutoff)) {
    throw new Error("Invalid archived task deletion cutoff");
  }
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (cursors.size >= 1000) throw new Error("Archived task pagination exceeds the page limit");
    const page = await provider.listTasks({
      archived: true,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const task of page.data) {
      if (task.projectId !== scopeId) throw new Error("Archived task listing crossed its scope");
      // 截止点为排他边界；无效更新时间不会命中，避免扩大日期清理范围。
      if (cutoff !== undefined && !(Date.parse(task.updatedAt) < cutoff)) continue;
      ids.add(task.id);
      if (ids.size > 10000) throw new Error("Archived task deletion exceeds the 10000 task limit");
    }
    if (page.nextCursor === null) break;
    if (cursors.has(page.nextCursor))
      throw new Error("Archived task pagination returned a repeated cursor");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  const tasks = [...ids];
  let deletedCount = 0;
  let failedCount = 0;
  // 有界并发，单项失败不阻止其他目标；结果可作为幂等响应缓存，避免重复扩大删除范围。
  for (let index = 0; index < tasks.length; index += 4) {
    const results = await Promise.allSettled(
      tasks.slice(index, index + 4).map(async (id) => {
        const task = await (provider.readTaskMetadata?.(id) ?? provider.readTask(id));
        if (task?.projectId !== scopeId) throw new Error("Archived task is no longer in scope");
        // 分页收集后任务可能发生更新，执行前再次检查，保护近期活动的会话。
        if (cutoff !== undefined && !(Date.parse(task.updatedAt) < cutoff)) {
          throw new Error("Archived task no longer matches the deletion cutoff");
        }
        await provider.deleteTask(id);
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") deletedCount++;
      else failedCount++;
    }
  }
  return { deletedCount, failedCount };
}
