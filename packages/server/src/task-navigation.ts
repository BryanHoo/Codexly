import type { AgentProvider, AgentProviderTaskSnapshot } from "@codexly/core";

const ARCHIVE_PAGE_SIZE = 100;
const UNAVAILABLE_TASK_MESSAGE =
  /thread.*(?:not loaded|not found|does not exist|deleted|archived)|no rollout found/iu;

async function isArchived(
  provider: AgentProvider,
  taskId: string,
  pinnedOnly: boolean,
): Promise<boolean> {
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await provider.listTasks({
      archived: true,
      limit: ARCHIVE_PAGE_SIZE,
      ...(pinnedOnly ? { pinnedOnly: true as const } : {}),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (page.data.some((task) => task.id === taskId)) return true;
    if (page.nextCursor === null) return false;
    if (cursors.has(page.nextCursor)) throw new Error("Task archive pagination did not advance");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export async function readNavigableProviderTask(
  provider: AgentProvider,
  projectId: string,
  taskId: string,
): Promise<AgentProviderTaskSnapshot | null> {
  let task: AgentProviderTaskSnapshot | undefined;
  try {
    task = await provider.readTask(taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (UNAVAILABLE_TASK_MESSAGE.test(message)) return null;
    throw error;
  }
  if (task?.projectId !== projectId) return null;
  // Codex 将普通归档与置顶归档分区分页，必须全部确认后才能允许导航。
  if ((await isArchived(provider, taskId, false)) || (await isArchived(provider, taskId, true))) {
    return null;
  }
  return task;
}
