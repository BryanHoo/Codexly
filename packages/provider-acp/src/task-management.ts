import {
  localTaskMetadata,
  type LocalCatalogStore,
  type LocalTask,
  type AgentProviderEventListener,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpProviderConnection } from "./provider-connection.js";
/** 应用元数据归应用管理；只有明确确认 ACP 原生删除后，才移除目录及展示投影。调用方持有任务串行锁。 */
export class AcpTaskManagement {
  readonly #queuedTitles = new Map<string, { sessionId: string }>();
  constructor(
    readonly engine: AgentEngine,
    readonly projectId: string | null,
    readonly store: LocalCatalogStore,
    readonly busy: (id: string) => boolean,
    readonly deleteNative: (task: LocalTask) => Promise<void>,
    readonly clear: (id: string) => Promise<void>,
    readonly emit: AgentProviderEventListener,
  ) {}
  async readTask(id: string): Promise<LocalTask> {
    const task = await this.store.catalog("task.read", { id });
    if (!task || task.provider !== this.engine || task.projectId !== this.projectId)
      throw new Error("任务不属于当前项目或引擎");
    return task;
  }
  syncAgentTitle(
    id: string,
    sessionId: string,
    link: AcpProviderConnection,
    schedule: (work: () => Promise<void>) => Promise<void>,
  ): void {
    if (this.#queuedTitles.get(id)?.sessionId === sessionId) return;
    const queued = { sessionId };
    this.#queuedTitles.set(id, queued);
    // 启动或恢复会话时已经持有任务锁，协议读循环不能反向等待目录写入。
    void schedule(async () => {
      if (this.#queuedTitles.get(id) !== queued) return;
      this.#queuedTitles.delete(id);
      if (link.sessions.get(id) !== sessionId) return;
      const title = link.instance?.readSessionState(sessionId).title;
      if (title === undefined) return;
      const normalized = title?.slice(0, 512).toWellFormed().trimEnd();
      const effective = await this.store.catalog("acp.title.agent", {
        id,
        sessionId,
        engine: this.engine,
        projectId: this.projectId,
        title: normalized === "" ? null : (normalized ?? null),
      });
      if (effective === null) return;
      // 清空最后一个来源后，沿用快照和列表的预览或新聊天占位标题。
      const displayTitle =
        effective === "" ? localTaskMetadata(await this.readTask(id)).title : effective;
      this.emit({ type: "task.metadata_changed", taskId: id, payload: { title: displayTitle } });
    }).catch(() => {
      if (this.#queuedTitles.get(id) === queued) this.#queuedTitles.delete(id);
    });
  }
  #idle(id: string): void {
    if (this.busy(id)) throw new Error("任务仍在运行或等待持久化");
  }
  async renameTask(id: string, title: string): Promise<void> {
    await this.readTask(id);
    if (!title.trim()) throw new Error("任务名称不能为空");
    const task = await this.store.catalog("task.patch", { id, title });
    this.emit({ type: "task.metadata_changed", taskId: id, payload: { title: task.title } });
  }
  async pinTask(id: string, pinned: boolean) {
    await this.readTask(id);
    const task = localTaskMetadata(await this.store.catalog("task.patch", { id, pinned }));
    // 应用元数据也走共享 Provider 事件，避免原生交付层误用固定 Codex 的旧事件。
    this.emit({ type: "task.metadata_changed", taskId: id, payload: {} });
    return task;
  }
  async archiveTask(id: string): Promise<void> {
    await this.readTask(id);
    this.#idle(id);
    await this.store.catalog("task.patch", { id, archived: true, status: "idle" });
    this.emit({ type: "task.removed", taskId: id, payload: { reason: "archived" } });
  }
  async unarchiveTask(id: string) {
    await this.readTask(id);
    this.#idle(id);
    const task = localTaskMetadata(await this.store.catalog("task.patch", { id, archived: false }));
    this.emit({ type: "task.metadata_changed", taskId: id, payload: {} });
    return task;
  }
  async deleteTask(id: string): Promise<void> {
    const task = await this.readTask(id);
    this.#idle(id);
    await this.deleteNative(task);
    await this.clear(id);
    await this.store.catalog("task.remove", { id });
    this.emit({ type: "task.removed", taskId: id, payload: { reason: "deleted" } });
  }
}
