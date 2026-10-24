import type { NativeArchivedTaskClient } from "../../projects/project-queries.js";
import type { DeleteArchivedTasksRequest } from "@codexly/protocol";

const ARCHIVED_TASK_DELETE_BATCH_SIZE = 4;
const ARCHIVED_TASK_DELETE_LIST_LIMIT = 100;

async function listAllArchivedTaskIds(
  client: NativeArchivedTaskClient,
  projectId: string,
  cutoff?: number,
): Promise<readonly string[]> {
  const taskIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    if (seenCursors.size >= 1000)
      throw new Error("Archived task pagination exceeds the page limit");
    const page = await client.listTasks(projectId, {
      archived: true,
      ...(cursor === undefined ? {} : { cursor }),
      limit: ARCHIVED_TASK_DELETE_LIST_LIMIT,
    });
    for (const task of page.data) {
      if (task.projectId !== projectId) throw new Error("Archived task listing crossed its scope");
      // 先收集所有分页中的匹配任务，不能只清理当前页或把搜索结果当作删除范围。
      if (cutoff !== undefined && !(Date.parse(task.updatedAt) < cutoff)) continue;
      taskIds.add(task.id);
      if (taskIds.size > 10000)
        throw new Error("Archived task deletion exceeds the 10000 task limit");
    }
    if (page.nextCursor === null) break;
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Archived task pagination returned a repeated cursor");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return [...taskIds];
}

export async function deleteAllArchivedTasks(
  client: NativeArchivedTaskClient,
  projectId: string,
  options: DeleteArchivedTasksRequest = {},
): Promise<void> {
  const cutoff =
    options.updatedBefore === undefined ? undefined : Date.parse(options.updatedBefore);
  if (cutoff !== undefined && !Number.isFinite(cutoff))
    throw new Error("Invalid archived task deletion cutoff");
  const taskIds = await listAllArchivedTaskIds(client, projectId, cutoff);
  let firstFailure: Error | undefined;

  // 固定小批次避免大量归档任务同时压满 Codex App Server。
  for (let index = 0; index < taskIds.length; index += ARCHIVED_TASK_DELETE_BATCH_SIZE) {
    const batch = taskIds.slice(index, index + ARCHIVED_TASK_DELETE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((taskId) => client.deleteTask(projectId, taskId)),
    );
    for (const result of results) {
      if (result.status === "rejected" && firstFailure === undefined) {
        firstFailure =
          result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      }
    }
  }

  if (firstFailure !== undefined) throw firstFailure;
}
