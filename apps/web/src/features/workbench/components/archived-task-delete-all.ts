import type { CodexlyArchivedTaskClient } from "../../projects/project-queries.js";

const ARCHIVED_TASK_DELETE_BATCH_SIZE = 4;
const ARCHIVED_TASK_DELETE_LIST_LIMIT = 100;

async function listAllArchivedTaskIds(
  client: CodexlyArchivedTaskClient,
  projectId: string,
): Promise<readonly string[]> {
  const taskIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const page = await client.listTasks(projectId, {
      archived: true,
      ...(cursor === undefined ? {} : { cursor }),
      limit: ARCHIVED_TASK_DELETE_LIST_LIMIT,
    });
    for (const task of page.data) taskIds.add(task.id);
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
  client: CodexlyArchivedTaskClient,
  projectId: string,
): Promise<void> {
  const taskIds = await listAllArchivedTaskIds(client, projectId);
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
