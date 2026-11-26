import {
  localTaskMetadata,
  type LocalCatalogStore,
  type AgentTaskScope,
  type LocalTask,
  type AgentProviderEventListener,
} from "@codexly/core";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import type { AcpHistory } from "./history.js";
import type { AcpSessionInitialization } from "./session-initialization.js";
import type { AcpConnection } from "./connection.js";
import type { AcpEventProjection } from "./event-projection.js";
import type { AcpProviderConnection } from "./provider-connection.js";
import type { AcpSubagentBackground } from "./subagent-background.js";
import { publishAcpSessionState } from "./provider-session-events.js";
import { forkAcpTask, type ForkDependencies, type ForkPoint } from "./task-fork.js";
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
    private readonly forkDependencies?: (task: LocalTask) => ForkDependencies,
  ) {}
  async readTask(id: string): Promise<LocalTask> {
    const task = await this.store.catalog("task.read", { id });
    if (!task || task.provider !== this.engine || task.projectId !== this.projectId)
      throw new Error("任务不属于当前项目或引擎");
    return task;
  }
  #idle(id: string): void {
    if (this.busy(id)) throw new Error("任务仍在运行或等待持久化");
  }
  async forkTask(id: string, point: ForkPoint) {
    const source = await this.readTask(id);
    if (!this.forkDependencies) throw new Error("任务分支不可用");
    return forkAcpTask(source, point, this.forkDependencies(source));
  }
  async renameTask(id: string, title: string): Promise<void> {
    const current = await this.readTask(id);
    const normalized = title.trim();
    if (!normalized) throw new Error("任务名称不能为空");
    // 已持久化的同名标题无需重复写入或广播。预览不算正式标题，仍可手动保存成同名正式标题。
    if (current.title === normalized) return;
    const task = await this.store.catalog("task.patch", { id, title: normalized });
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

/** Provider 负责串行化，任务管理统一接管分支发布与目录清理使用的持久资源。 */
export function createAcpTaskManagement(
  provider: {
    engine: AgentEngine;
    scope: AgentTaskScope;
    store: LocalCatalogStore;
    history: AcpHistory;
    attachments: HistoricalTaskAttachments;
    initialization?: AcpSessionInitialization | undefined;
  },
  state: {
    link: AcpProviderConnection;
    active: ReadonlyMap<string, AcpEventProjection>;
    background: AcpSubagentBackground;
    needsDefaults: Set<string>;
    recover: (task: LocalTask) => Promise<AcpConnection>;
    emit: AgentProviderEventListener;
  },
): AcpTaskManagement {
  const { link, active, background, needsDefaults, recover, emit } = state;
  return new AcpTaskManagement(
    provider.engine,
    provider.scope.kind === "temporary" ? null : provider.scope.id,
    provider.store,
    (id) => active.has(id),
    async (task) => {
      await link.deleteSession(task.id, task.sessionId);
      await background.flush(task.id);
      needsDefaults.delete(task.id);
    },
    async (id) => {
      await provider.initialization?.deleteTask(id);
      await provider.history.deleteTask(id);
      await provider.attachments.deleteTask(id);
    },
    emit,
    (source) => ({
      store: provider.store,
      history: provider.history,
      attachments: provider.attachments,
      active: () => active.get(source.id)?.visibleSnapshot(),
      recover: () => recover(source),
      connect: () => link.get(),
      bind: (task, connection) => {
        if (!task.sessionId) return;
        link.sessions.set(task.id, task.sessionId);
        publishAcpSessionState(
          link,
          task.sessionId,
          connection.readSessionState(task.sessionId),
          emit,
        );
      },
    }),
  );
}
