import {
  localTaskMetadata,
  type LocalCatalogStore,
  type LocalTask,
  type AgentProviderEventListener,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
/** 应用元数据归应用管理；只有明确确认 ACP 原生删除后，才移除目录及展示投影。调用方持有任务串行锁。 */
export class AcpTaskManagement {
  constructor(
    readonly engine: AgentEngine,
    readonly projectId: string | null,
    readonly store: LocalCatalogStore,
    readonly busy: (id: string) => boolean,
    readonly deleteNative: (task: LocalTask) => Promise<void>,
    readonly clear: (id: string) => Promise<void>,
    readonly emit: AgentProviderEventListener,
  ) {}
  async #task(id: string): Promise<LocalTask> {
    const task = await this.store.catalog("task.read", { id });
    if (!task || task.provider !== this.engine || task.projectId !== this.projectId)
      throw new Error("任务不属于当前项目或引擎");
    return task;
  }
  #idle(id: string): void {
    if (this.busy(id)) throw new Error("任务仍在运行或等待持久化");
  }
  async renameTask(id: string, title: string): Promise<void> {
    await this.#task(id);
    if (!title.trim()) throw new Error("任务名称不能为空");
    await this.store.catalog("task.patch", { id, title });
    this.emit({ type: "task.metadata_changed", taskId: id, payload: { title } });
  }
  async pinTask(id: string, pinned: boolean) {
    await this.#task(id);
    const task = localTaskMetadata(await this.store.catalog("task.patch", { id, pinned }));
    // 应用元数据也走共享 Provider 事件，避免原生交付层误用固定 Codex 的旧事件。
    this.emit({ type: "task.metadata_changed", taskId: id, payload: {} });
    return task;
  }
  async archiveTask(id: string): Promise<void> {
    await this.#task(id);
    this.#idle(id);
    await this.store.catalog("task.patch", { id, archived: true, status: "idle" });
    this.emit({ type: "task.removed", taskId: id, payload: { reason: "archived" } });
  }
  async unarchiveTask(id: string) {
    await this.#task(id);
    this.#idle(id);
    const task = localTaskMetadata(await this.store.catalog("task.patch", { id, archived: false }));
    this.emit({ type: "task.metadata_changed", taskId: id, payload: {} });
    return task;
  }
  async deleteTask(id: string): Promise<void> {
    const task = await this.#task(id);
    this.#idle(id);
    await this.deleteNative(task);
    await this.clear(id);
    await this.store.catalog("task.remove", { id });
    this.emit({ type: "task.removed", taskId: id, payload: { reason: "deleted" } });
  }
}
