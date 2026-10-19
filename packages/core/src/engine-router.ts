import type { AgentEngine, AgentTask } from "@codexly/protocol";
import type {
  AgentProvider,
  AgentProviderEventListener,
  AgentTaskScope,
  ListAgentTasksInput,
  StartAgentTaskOptions,
} from "./agent-provider.js";
import type { LocalCatalogStore, LocalTask } from "./local-catalog.js";

export type AgentExecutionAdapter = Partial<AgentProvider> &
  Pick<AgentProvider, "startTask" | "readTask" | "startTurn" | "subscribeEvents">;

export function localTaskMetadata(task: LocalTask): AgentTask {
  if (task.provider !== "codex" && task.provider !== "claude")
    throw new Error("Unsupported task engine");
  return {
    engine: task.provider,
    id: task.id,
    projectId: task.projectId ?? "temporary",
    title: task.title || "新聊天",
    pinned: task.pinned,
    updatedAt: new Date(task.updatedAt * 1000).toISOString(),
    workspacePath: task.cwd,
  };
}

/** 应用身份负责路由，适配器只执行自己拥有的任务；全局当前选择不能影响历史任务。 */
export class EngineProjectRouter implements AgentProvider {
  readonly #ephemeral = new Map<string, AgentEngine>();
  readonly #listeners = new Map<AgentProviderEventListener, boolean>();
  readonly #subscriptions = new Map<
    AgentEngine,
    { adapter: AgentExecutionAdapter; dispose: () => void }
  >();
  constructor(
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly adapters: Readonly<
      Record<AgentEngine, AgentExecutionAdapter | (() => AgentExecutionAdapter)>
    >,
  ) {}

  #adapter(engine: AgentEngine): AgentExecutionAdapter {
    const source = this.adapters[engine];
    const adapter = typeof source === "function" ? source() : source;
    const subscription = this.#subscriptions.get(engine);
    if (this.#listeners.size && subscription?.adapter !== adapter) {
      // 路由可比执行适配器存活更久；回收或断开后，先迁移订阅再调用新适配器。
      subscription?.dispose();
      this.#subscriptions.set(engine, {
        adapter,
        dispose: adapter.subscribeEvents(
          (event) => {
            for (const [listener, includeEphemeral] of this.#listeners) {
              if (!this.#ephemeral.has(event.taskId) || includeEphemeral)
                listener({ ...event, provider: engine });
            }
          },
          { includeEphemeral: true },
        ),
      });
    }
    return adapter;
  }

  async #task(id: string): Promise<LocalTask> {
    const task = await this.store.catalog("task.read", { id });
    if (!task || task.projectId !== (this.scope.kind === "temporary" ? null : this.scope.id))
      throw new Error("Task not found in this project");
    return task;
  }

  #engineMethod<K extends keyof AgentProvider>(
    engine: AgentEngine,
    key: K,
  ): NonNullable<AgentProvider[K]> {
    return ((...args: unknown[]) => {
      // 任务身份查询含异步边界；实际执行时再取适配器，避免等待期间被回收的旧引用。
      const adapter = this.#adapter(engine),
        method = adapter[key];
      if (typeof method !== "function") throw new Error(`${engine} does not support ${key}`);
      return Reflect.apply(method, adapter, args) as unknown;
    }) as NonNullable<AgentProvider[K]>;
  }

  async #method<K extends keyof AgentProvider>(
    id: string,
    key: K,
  ): Promise<NonNullable<AgentProvider[K]>> {
    const ephemeral = this.#ephemeral.get(id);
    if (ephemeral) return this.#engineMethod(ephemeral, key);
    const task = await this.#task(id);
    if (task.provider !== "codex" && task.provider !== "claude")
      throw new Error("Unsupported task engine");
    return this.#engineMethod(task.provider, key);
  }

  async startTask(options: StartAgentTaskOptions = {}) {
    const engine = options.engine ?? "codex";
    const task = await this.#engineMethod(engine, "startTask")(options);
    // 辅助任务没有持久目录记录，执行路由只保留到退订，不能放宽普通任务校验。
    if (options.ephemeral) this.#ephemeral.set(task.id, engine);
    return task;
  }
  getCapabilities(engine: AgentEngine = "codex") {
    return this.#engineMethod(engine, "getCapabilities")();
  }
  listModels(engine: AgentEngine = "codex") {
    return this.#engineMethod(engine, "listModels")();
  }
  listSkills(engine: AgentEngine = "codex") {
    return this.#engineMethod(engine, "listSkills")();
  }
  readSandboxMode() {
    return this.#engineMethod("codex", "readSandboxMode")();
  }

  async readTaskMetadata(id: string): Promise<AgentTask | undefined> {
    const task = await this.store.catalog("task.read", { id });
    return task?.projectId === (this.scope.kind === "temporary" ? null : this.scope.id)
      ? localTaskMetadata(task)
      : undefined;
  }

  async listTasks(input: ListAgentTasksInput = {}) {
    const page = await this.store.catalog("task.list", {
      projectId: this.scope.kind === "temporary" ? null : this.scope.id,
      ...(input.archived ? { archived: true } : {}),
      ...(input.completed ? { completed: true } : {}),
      ...(input.pinnedOnly ? { pinned: true } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.searchTerm ? { searchTerm: input.searchTerm } : {}),
    });
    return { ...page, data: page.data.map(localTaskMetadata) };
  }

  subscribeEvents(
    listener: AgentProviderEventListener,
    options?: Parameters<AgentProvider["subscribeEvents"]>[1],
  ) {
    this.#listeners.set(listener, options?.includeEphemeral === true);
    try {
      this.#adapter("codex");
      this.#adapter("claude");
    } catch (error) {
      this.#listeners.delete(listener);
      this.#disposeSubscriptions();
      throw error;
    }
    return () => {
      this.#listeners.delete(listener);
      this.#disposeSubscriptions();
    };
  }

  #disposeSubscriptions(): void {
    if (this.#listeners.size) return;
    for (const subscription of this.#subscriptions.values()) subscription.dispose();
    this.#subscriptions.clear();
  }

  async readTask(...args: Parameters<AgentProvider["readTask"]>) {
    return (await this.#method(args[0], "readTask"))(args[0], args[1]);
  }
  async startTurn(...args: Parameters<AgentProvider["startTurn"]>) {
    return (await this.#method(args[0], "startTurn"))(...args);
  }
  async stopSession(taskId: string, backgroundTaskId?: string) {
    return (await this.#method(taskId, "stopSession"))(taskId, backgroundTaskId);
  }
  async interruptTurn(...args: Parameters<AgentProvider["interruptTurn"]>) {
    return (await this.#method(args[0], "interruptTurn"))(...args);
  }
  async resolvePendingRequest(...args: Parameters<AgentProvider["resolvePendingRequest"]>) {
    return (await this.#method(args[0].taskId, "resolvePendingRequest"))(...args);
  }
  async archiveTask(...args: Parameters<AgentProvider["archiveTask"]>) {
    return (await this.#method(args[0], "archiveTask"))(...args);
  }
  async unarchiveTask(...args: Parameters<AgentProvider["unarchiveTask"]>) {
    return (await this.#method(args[0], "unarchiveTask"))(...args);
  }
  async deleteTask(...args: Parameters<AgentProvider["deleteTask"]>) {
    return (await this.#method(args[0], "deleteTask"))(...args);
  }
  async renameTask(...args: Parameters<AgentProvider["renameTask"]>) {
    return (await this.#method(args[0], "renameTask"))(...args);
  }
  async pinTask(...args: Parameters<AgentProvider["pinTask"]>) {
    return (await this.#method(args[0], "pinTask"))(...args);
  }
  async forkTask(...args: Parameters<AgentProvider["forkTask"]>) {
    return (await this.#method(args[0], "forkTask"))(...args);
  }
  async compactTask(...args: Parameters<AgentProvider["compactTask"]>) {
    return (await this.#method(args[0], "compactTask"))(...args);
  }
  async clearGoal(...args: Parameters<AgentProvider["clearGoal"]>) {
    return (await this.#method(args[0], "clearGoal"))(...args);
  }
  async readGoal(...args: Parameters<AgentProvider["readGoal"]>) {
    return (await this.#method(args[0], "readGoal"))(...args);
  }
  async updateGoal(...args: Parameters<AgentProvider["updateGoal"]>) {
    return (await this.#method(args[0], "updateGoal"))(...args);
  }
  async listMcpServers(...args: Parameters<AgentProvider["listMcpServers"]>) {
    return (await this.#method(args[0], "listMcpServers"))(...args);
  }
  async listBackgroundTerminals(...args: Parameters<AgentProvider["listBackgroundTerminals"]>) {
    return (await this.#method(args[0], "listBackgroundTerminals"))(...args);
  }
  async readTaskAttachment(...args: Parameters<AgentProvider["readTaskAttachment"]>) {
    return (await this.#method(args[0], "readTaskAttachment"))(...args);
  }
  async reloadMcpServers(...args: Parameters<AgentProvider["reloadMcpServers"]>) {
    return (await this.#method(args[0], "reloadMcpServers"))(...args);
  }
  async startReview(...args: Parameters<AgentProvider["startReview"]>) {
    return (await this.#method(args[0], "startReview"))(...args);
  }
  async steerTurn(...args: Parameters<AgentProvider["steerTurn"]>) {
    return (await this.#method(args[0], "steerTurn"))(...args);
  }
  async updateTurnApprovalsReviewer(
    ...args: Parameters<AgentProvider["updateTurnApprovalsReviewer"]>
  ) {
    return (await this.#method(args[0], "updateTurnApprovalsReviewer"))(...args);
  }
  async terminateBackgroundTerminal(
    ...args: Parameters<AgentProvider["terminateBackgroundTerminal"]>
  ) {
    return (await this.#method(args[0], "terminateBackgroundTerminal"))(...args);
  }
  async unsubscribeTask(...args: Parameters<AgentProvider["unsubscribeTask"]>) {
    try {
      return await (
        await this.#method(args[0], "unsubscribeTask")
      )(...args);
    } finally {
      this.#ephemeral.delete(args[0]);
    }
  }
  async uploadFeedback(...args: Parameters<AgentProvider["uploadFeedback"]>) {
    return (await this.#method(args[0], "uploadFeedback"))(...args);
  }
}
