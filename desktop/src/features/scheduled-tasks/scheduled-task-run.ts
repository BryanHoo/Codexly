import type { NativeClient } from "@/platform/native-client-contract.js";

export async function readScheduledTaskRun(client: Pick<NativeClient, "readTask" | "listTasks">, projectId: string, taskId: string) {
  let response;
  try {
    // 绕过缓存，避免历史快照仍在但线程已经被删除；成功结果供目标页面复用。
    response = await client.readTask(projectId, taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (/thread.*(?:not loaded|not found|does not exist|deleted|archived)|no rollout found/iu.test(message)) return null;
    throw error;
  }
  // 归档线程仍可能可读，需核对权威归档列表；固定与普通任务属于不同分区。
  for (const pinned of [false, true]) {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await client.listTasks(projectId, {
        archived: true, limit: 100,
        ...(pinned ? { pinned: true } : {}),
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (page.data.some((task) => task.id === taskId)) return null;
      if (page.nextCursor === null) break;
      if (cursors.has(page.nextCursor)) throw new Error("Task archive pagination did not advance");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }
  return response;
}
