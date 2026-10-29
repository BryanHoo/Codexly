import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeQueueRepository } from "./queue-repository.js";
import type { LocalCatalogStore, LocalTask } from "@codexly/core";
import type { ClaudeConfiguration } from "./config.js";
import { hasWork, type ClaudeSdk, type Running } from "./session.js";

interface ClaudeTaskRemovalProvider {
  config: ClaudeConfiguration;
  sdk: ClaudeSdk;
  store: LocalCatalogStore;
  stopSession(id: string): Promise<void>;
}

/** 两端共用归档边界：只校正没有真实工作的旧 active 标记，并保留完整历史。 */
export async function archiveClaudeTask(
  task: LocalTask,
  provider: ClaudeTaskRemovalProvider,
  starting: Set<string>,
  sessions: ReadonlyMap<string, Running>,
): Promise<void> {
  const id = task.id;
  const running = sessions.get(id);
  if (starting.has(id) || (running && (running.settling || hasWork(running))))
    throw new Error("Stop the running task before archiving");
  // 与启动、删除共用占用标记；校正旧状态和归档之间不能插入新回合。
  starting.add(id);
  try {
    if (running) await provider.stopSession(id);
    // active 也可能表示终态尚未落盘，归档前先重试，失败时保留恢复入口。
    const recovery = await provider.config.persistence.retry(id);
    if (recovery?.pending)
      throw new Error("Claude task persistence must complete before archiving");
    const latest = await provider.store.catalog("task.read", { id });
    // 宿主退出或目录终态写入失败会遗留 active；确认会话空闲后按元数据校正，
    // 无需加载聊天正文，也不要求用户先打开历史才能通过两端目录的运行保护。
    if (latest?.status === "active")
      await provider.store.catalog("task.patch", { id, status: "idle" });
    await provider.store.catalog("task.patch", { id, archived: true });
  } finally {
    starting.delete(id);
  }
}

/** 两端共用永久删除事务：先释放会话及私有数据，最后移除可重试的目录记录。 */
export async function deleteClaudeTask(
  task: LocalTask,
  provider: ClaudeTaskRemovalProvider,
  starting: Set<string>,
  sessions: ReadonlyMap<string, Running>,
): Promise<void> {
  const running = sessions.get(task.id);
  if (starting.has(task.id) || (running && (running.settling || hasWork(running))))
    throw new Error("Stop the running task before deleting");
  // 与启动共享任务占用标记，异步清理期间不能再次发送回合或重复删除。
  starting.add(task.id);
  try {
    if (running) await provider.stopSession(task.id);
    if (task.sessionId) {
      try {
        // 只使用已验证归属的目录记录，不枚举或删除用户其他 CLI 会话。
        await provider.sdk.deleteSession(task.sessionId, { dir: task.cwd });
      } catch (error) {
        // SDK 对未创建或已删除的会话报精确的 not-found；其他错误必须保留重试入口。
        if (
          !(error instanceof Error) ||
          error.message !==
            `Session ${task.sessionId} not found in project directory for ${task.cwd}`
        )
          throw error;
      }
    }
    await rm(
      new ClaudeQueueRepository(join(provider.config.attachments.directory, "..", "queues")).path(
        task.id,
      ),
      { force: true },
    );
    await provider.config.persistence.deleteTask(task.id);
    await provider.config.attachments.deleteTask(task.id);
    // 已确认没有真实工作且持有启动占用；私有数据清理后解除遗留 active 标记，
    // 防止 Web/桌面目录在最后一步拒绝删除，留下历史已清理却无法移除的空任务。
    if (task.status === "active")
      await provider.store.catalog("task.patch", { id: task.id, status: "idle" });
    await provider.store.catalog("task.remove", { id: task.id });
  } finally {
    starting.delete(task.id);
  }
}
