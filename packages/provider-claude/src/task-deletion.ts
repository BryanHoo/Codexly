import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeQueueRepository } from "./queue-repository.js";
import type { LocalCatalogStore, LocalTask } from "@codexly/core";
import type { ClaudeConfiguration } from "./config.js";
import { hasWork, type ClaudeSdk, type Running } from "./session.js";

/** 两端共用永久删除事务：先释放会话及私有数据，最后移除可重试的目录记录。 */
export async function deleteClaudeTask(
  task: LocalTask,
  provider: {
    config: ClaudeConfiguration;
    sdk: ClaudeSdk;
    store: LocalCatalogStore;
    stopSession(id: string): Promise<void>;
  },
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
    await provider.store.catalog("task.remove", { id: task.id });
  } finally {
    starting.delete(task.id);
  }
}
