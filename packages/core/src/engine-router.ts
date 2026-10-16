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
  readonly #listeners = new Set<AgentProviderEventListener>();
  constructor(
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly adapters: Readonly<Record<AgentEngine, AgentExecutionAdapter>>,
  ) {}

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
    const adapter = this.adapters[engine],
      method = adapter[key];
    if (typeof method !== "function") throw new Error(`${engine} does not support ${key}`);
    return method.bind(adapter) as NonNullable<AgentProvider[K]>;
  }

  async #method<K extends keyof AgentProvider>(
    id: string,
    key: K,
  ): Promise<NonNullable<AgentProvider[K]>> {
    const task = await this.#task(id);
    if (task.provider !== "codex" && task.provider !== "claude")
      throw new Error("Unsupported task engine");
    return this.#engineMethod(task.provider, key);
  }

  startTask(options: StartAgentTaskOptions = {}) {
    return this.#engineMethod(options.engine ?? "codex", "startTask")(options);
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

  subscribeEvents(listener: AgentProviderEventListener) {
    this.#listeners.add(listener);
    const dispose = Object.entries(this.adapters).map(([provider, adapter]) =>
      adapter.subscribeEvents((event) => {
        listener({ ...event, provider });
      }),
    );
    return () => {
      this.#listeners.delete(listener);
      dispose.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }

  async readTask(...args: Parameters<AgentProvider["readTask"]>) {
    return (await this.#method(args[0], "readTask"))(args[0], args[1]);
  }
  async startTurn(...args: Parameters<AgentProvider["startTurn"]>) {
    return (await this.#method(args[0], "startTurn"))(...args);
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
    return (await this.#method(args[0], "unsubscribeTask"))(...args);
  }
  async uploadFeedback(...args: Parameters<AgentProvider["uploadFeedback"]>) {
    return (await this.#method(args[0], "uploadFeedback"))(...args);
  }
}
