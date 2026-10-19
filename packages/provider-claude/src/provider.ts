import { createClaudeTask } from "./task-creation.js";
import { observePermissionMode, updatePermissionMode } from "./session-permission-mode.js";
import type { ClaudePermissionMode } from "@codexly/protocol";
import { DEFAULT_CLAUDE_SDK } from "./sdk-defaults.js";
import { ClaudeTurnSteering } from "./turn-steering.js";
import { interruptForeground } from "./session-interruption.js";
import { createClaudeQuery, reuseClaudeQuery } from "./session-query.js";
import {
  claudeQuerySettingsKey,
  claudeSessionSettings,
  updateClaudeSessionSettings,
} from "./session-settings.js";
import { localTaskMetadata as claudeTask } from "@codexly/core";
export { localTaskMetadata as claudeTask } from "@codexly/core";
import type { ClaudeMcpAction } from "./mcp.js";
import { ClaudeMcpManagement } from "./mcp-management.js";
import { isManagedClaudeCommand } from "./commands.js";
import { deleteClaudeTask } from "./task-deletion.js";
import { forkClaudeTask } from "./task-fork.js";
import { ClaudeTaskTitles } from "./task-titles.js";
import { CLAUDE_CAPABILITIES } from "./capabilities.js";
export { CLAUDE_CAPABILITIES } from "./capabilities.js";
import { randomUUID } from "node:crypto";
import type {
  AgentProviderEventListener,
  AgentProviderTurnInput,
  AgentProviderTaskSnapshot as TaskSnapshot,
  AgentTaskScope,
  LocalCatalogStore,
  LocalTask,
  ReadAgentTaskInput,
  ResolvePendingRequestInput,
  StartAgentTaskOptions,
} from "@codexly/core";
import type {
  AgentCapabilities,
  AgentEngineProfile,
  AgentTask,
  AgentTurn,
  AgentTurnOptions,
} from "@codexly/protocol";
import type { ClaudeConfiguration } from "./config.js";
import { ClaudePermissions } from "./permissions.js";
import { ClaudeSessionGrants } from "./session-grants.js";
import * as session from "./session.js";
import { readClaudeTaskSnapshot } from "./task-snapshot.js";
import { createClaudePrompt } from "./turn-input.js";
export type { ClaudeSdk } from "./session.js";
export class ClaudeAgentProvider {
  readonly #listeners = new Set<AgentProviderEventListener>();
  readonly #running = new Map<string, session.Running>();
  readonly #starting = new Set<string>();
  readonly #steering: ClaudeTurnSteering;
  readonly #recent = new Map<string, AgentTurn>();
  readonly #unpersisted = new Set<string>();
  readonly #sessionGrants = new Map<string, ClaudeSessionGrants>();
  readonly #mcp: ClaudeMcpManagement;
  readonly #titles: ClaudeTaskTitles;
  constructor(
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly config: ClaudeConfiguration,
    readonly sdk: session.ClaudeSdk = DEFAULT_CLAUDE_SDK,
    readonly discover?: () => Promise<AgentEngineProfile>,
    readonly idleTimeoutMs = 30_000,
  ) {
    this.#steering = new ClaudeTurnSteering((id) => this.#running.get(id), config);
    this.#titles = new ClaudeTaskTitles(sdk, config, store, this.#emit);
    this.#mcp = new ClaudeMcpManagement(config, sdk, this.#starting, this.#running, (id) =>
      this.#task(id),
    );
  }
  get isBusy() {
    return (
      this.#starting.size > 0 ||
      this.#titles.isBusy ||
      this.#unpersisted.size > 0 ||
      [...this.#running.values()].some(
        (running) => running.settling === true || session.hasWork(running),
      )
    );
  }
  async listModels() {
    if (!this.discover) throw new Error("Claude model discovery unavailable");
    return (await this.discover()).models;
  }
  listSkills() {
    return Promise.resolve({ data: [], nextCursor: null });
  }
  listMcpServers(id: string) {
    return this.#mcp.listMcpServers(id);
  }
  reloadMcpServers(id: string, action?: ClaudeMcpAction) {
    return this.#mcp.reloadMcpServers(id, action);
  }
  listBackgroundTerminals() {
    return Promise.resolve({ data: [], nextCursor: null });
  }
  async readTaskAttachment(id: string, attachmentId: string) {
    await this.#task(id);
    return this.config.attachments.read(id, attachmentId);
  }
  readGoal() {
    return Promise.resolve(null);
  }
  unsubscribeTask(id: string) {
    const running = this.#running.get(id);
    return Promise.resolve(
      running && (running.settling || session.hasWork(running))
        ? ("busy" as const)
        : ("notLoaded" as const),
    );
  }
  async pinTask(id: string, pinned: boolean) {
    await this.#task(id);
    return claudeTask(await this.store.catalog("task.patch", { id, pinned }));
  }
  async renameTask(id: string, title: string) {
    await this.#task(id);
    await this.#titles.rename(id, title);
  }
  async archiveTask(id: string) {
    await this.#task(id);
    const running = this.#running.get(id);
    if (running && (running.settling || session.hasWork(running)))
      throw new Error("Stop the running task before archiving");
    if (running) await this.stopSession(id);
    this.#titles.forget(id);
    await this.store.catalog("task.patch", { id, archived: true });
    this.#sessionGrants.delete(id);
    this.#emit({ type: "task.removed", taskId: id, payload: { reason: "archived" } });
  }
  async unarchiveTask(id: string) {
    await this.#task(id);
    return claudeTask(await this.store.catalog("task.patch", { id, archived: false }));
  }
  async deleteTask(id: string) {
    if (this.#starting.has(id)) throw new Error("Stop the running task before deleting");
    await this.#titles.mutate(id, async () => {
      await deleteClaudeTask(await this.#task(id), this, this.#starting, this.#running);
      this.#titles.forget(id);
      this.#sessionGrants.delete(id);
      this.#recent.delete(id);
      this.#unpersisted.delete(id);
      this.#emit({ type: "task.removed", taskId: id, payload: { reason: "deleted" } });
    });
  }
  getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve(CLAUDE_CAPABILITIES);
  }
  subscribeEvents(listener: AgentProviderEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  readonly #emit: AgentProviderEventListener = (event) => {
    if (event.type === "turn.completed" && event.payload.turn.persistence)
      this.#markUnpersisted(event.taskId, event.payload.turn.persistence.error);
    for (const listener of this.#listeners) listener(event);
  };
  /** 两端复用运行警告展示；同一轮故障只提示一次，避免读取重试时反复刷屏。 */
  #markUnpersisted(id: string, error: string | null): void {
    if (this.#unpersisted.has(id)) return;
    this.#unpersisted.add(id);
    this.#emit({
      type: "task.notice",
      taskId: id,
      payload: {
        code: "runtime_warning",
        level: "warning",
        message:
          `Claude 历史持久化失败，执行结果已保留；修复存储后读取或再次发送将重试。${error ?? ""}`.slice(
            0,
            8192,
          ),
      },
    });
  }
  async #task(id: string): Promise<LocalTask> {
    const task = await this.store.catalog("task.read", { id });
    if (!task || task.projectId !== (this.scope.kind === "temporary" ? null : this.scope.id))
      throw new Error("Task not found in this project");
    if (task.provider !== "claude") throw new Error("Task belongs to another engine");
    return task;
  }
  async startTask(options: StartAgentTaskOptions = {}): Promise<AgentTask> {
    const task = createClaudeTask(this.scope, options.workspacePath);
    return claudeTask(await this.store.catalog("task.put", task));
  }
  async readTaskMetadata(id: string): Promise<AgentTask | undefined> {
    const task = await this.store.catalog("task.read", { id });
    return task?.provider === "claude" &&
      task.projectId === (this.scope.kind === "temporary" ? null : this.scope.id)
      ? claudeTask(task)
      : undefined;
  }
  async readTask(id: string, input: ReadAgentTaskInput = {}): Promise<TaskSnapshot | undefined> {
    input.signal?.throwIfAborted();
    const task = await this.#task(id);
    input.signal?.throwIfAborted();
    // 显式读取也是恢复入口；即使旧查询已经退出，也不能让最近回合缓存掩盖写盘故障。
    const recovery = await this.config.persistence.retry(id);
    input.signal?.throwIfAborted();
    if (recovery?.pending) this.#markUnpersisted(id, recovery.turns[0]?.persistence?.error ?? null);
    else this.#unpersisted.delete(id);
    return readClaudeTaskSnapshot({
      task,
      input,
      config: this.config,
      store: this.store,
      current: this.#running.get(id),
      recent: this.#recent,
      starting: this.#starting.has(id),
      recovery,
    });
  }
  updateTaskPermissionMode(id: string, mode: ClaudePermissionMode): Promise<void> {
    return updatePermissionMode(id, mode, {
      starting: this.#starting,
      running: this.#running.get(id),
      grants: this.#sessionGrants.get(id),
      config: this.config,
      validate: () => this.#task(id),
      emit: this.#emit,
    });
  }
  async startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    return this.#startTurn(id, input, options);
  }
  steerTurn(id: string, turnId: string, input: AgentProviderTurnInput): Promise<void> {
    return this.#steering.send(id, turnId, input);
  }
  /** 专用压缩仍是原生命令回合；受理后由 SDK result 决定真实终态及未压缩原因。 */
  async compactTask(id: string, options?: AgentTurnOptions): Promise<void> {
    if (!options) throw new Error("Claude 压缩需要当前会话设置");
    await this.#startTurn(
      id,
      { text: "/compact", files: [], images: [], skills: [], textAttachments: [] },
      options,
      true,
    );
  }
  async forkTask(id: string, lastTurnId?: string): Promise<AgentTask> {
    const running = this.#running.get(id);
    if (this.#starting.has(id) || (running && (running.settling || session.hasWork(running))))
      throw new Error("请先停止 Claude 的前台与后台工作再分叉");
    // 与启动、删除共用占用标记；等待写盘和复制期间不能产生新的源会话消息。
    this.#starting.add(id);
    try {
      const task = await this.#task(id);
      if (running) await this.stopSession(id);
      return claudeTask(await forkClaudeTask(task, lastTurnId, this.config, this.sdk, this.store));
    } finally {
      this.#starting.delete(id);
    }
  }
  async #startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
    compact = false,
  ): Promise<AgentTurn> {
    // 失败终态不能像最近回合缓存一样淘汰；存储持续不可用时对新增会话施加有界背压。
    if (this.config.persistence.pendingCount >= 8 && !this.config.persistence.hasPending(id))
      throw new Error("Claude 历史持久化待恢复任务已达上限，请修复存储后重试");
    if (
      this.#starting.has(id) ||
      this.#running.get(id)?.settling ||
      this.#running.get(id)?.projection.status === "running"
    )
      throw new Error("A Claude turn is already running");
    if (!this.#running.has(id) && this.#starting.size + this.#running.size >= 8) {
      const idle = [...this.#running].find(
        ([taskId, candidate]) =>
          !this.#starting.has(taskId) && !candidate.settling && !session.hasWork(candidate),
      );
      if (idle) {
        session.stop(idle[1]);
        await idle[1].done;
      }
      if (this.#starting.size + this.#running.size >= 8)
        throw new Error("Claude concurrent turn capacity exceeded");
    }
    this.#starting.add(id);
    const current = this.#running.get(id);
    clearTimeout(current?.idleTimer);
    if (current) current.idleTimer = undefined;
    try {
      const task = await this.#task(id);
      if (compact && (!task.sessionId || (current && session.hasWork(current))))
        throw new Error("Claude 压缩需要已有上下文且没有前台或后台工作");
      const recovery = await this.config.persistence.retry(id);
      if (recovery?.pending) throw new Error("Claude 历史持久化尚未完成，请修复存储后重试");
      this.#unpersisted.delete(id);
      const defaults = await this.config.readSettings();
      if (task.archived) throw new Error("Cannot run an archived task");
      if (isManagedClaudeCommand(input.text))
        throw new Error("This command is unavailable in managed Claude conversations");
      if (options.goalMode || options.fastMode || input.skills.length)
        throw new Error("This capability is not supported by the Claude adapter");
      const permissionMode = options.engineOptions?.permissionMode ?? defaults.permissionMode;
      const sessionId = task.sessionId ?? randomUUID(),
        turnId = randomUUID();
      const prompt = await createClaudePrompt(input, sessionId, turnId);
      const attachments = await this.config.attachments.prepare(id, input);
      const userInput = { text: input.text, attachments };
      const { projection, itemChanges } = session.createProjection(
        id,
        turnId,
        userInput,
        this.#emit,
        undefined,
        task.cwd,
      );
      const metadata = await this.config.history.metadata(id);
      projection.restoreMetadata(metadata);
      const grants = this.#sessionGrants.get(id) ?? new ClaudeSessionGrants(permissionMode);
      // 各回合共享同一授权集合，后台旧回合的迟到审批也只合并到当前聊天。
      this.#sessionGrants.set(id, grants);
      const permissions = new ClaudePermissions(this.scope.id, id, turnId, this.#emit, grants);
      const controller = new AbortController();
      // 每轮读取有效连接摘要，覆盖设置页保存和外部编辑；变更后沿用原生会话 ID 重建查询。
      const connectionRevision = await this.config.connectionRevision();
      const settings = claudeSessionSettings(options, permissionMode, defaults);
      const settingsKey = claudeQuerySettingsKey(
        options,
        defaults,
        connectionRevision,
        input.outputSchema,
      );
      const existing = await reuseClaudeQuery(this.#running.get(id), settingsKey);
      if (existing && existing.projections.size >= 64)
        throw new Error("Claude background turn capacity exceeded");
      // 在持久化新回合、发布 started 和发送输入前等待控制确认；失败保持原查询及后台任务。
      if (existing) {
        await updateClaudeSessionSettings(existing.query, existing.settings, settings, grants);
        observePermissionMode(id, existing, existing.settings.permissionMode, this.#emit);
      }
      const resumable =
        !existing && (await session.canResume(task, this.sdk, this.config.history, metadata));
      if (compact && !existing && !resumable) throw new Error("Claude 原生会话尚未建立，无法压缩");
      // 原生恢复校验通过后先幂等归档崩溃检查点，避免新回合覆盖后丢失界面历史。
      if (!existing) await this.config.history.archiveActive(id);
      // 发送前持久绑定精确 UUID；进程重启或请求重试不能改绑到另一个会话。
      await this.store.catalog("task.patch", {
        id,
        sessionId,
        status: "active",
        updatedAt: Date.now() / 1000,
      });
      if (existing) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
        projection.backgroundTasks = existing.backgroundTasks;
        projection.restoreMetadata(existing.projection.metadata());
        await session.checkpoint(id, projection, this.config);
        existing.projection = projection;
        existing.projections.set(turnId, projection);
        existing.itemChanges.set(turnId, itemChanges);
        existing.permissions.set(turnId, permissions);
        this.#emit({
          type: "turn.started",
          taskId: id,
          turnId,
          payload: { turn: projection.snapshot() },
        });
        existing.input.send(prompt);
        this.#titles.start(task, input);
        return projection.snapshot();
      }
      // 启动失败但未收到 SDK 消息时保留 false，允许下次仍以原 UUID 首次创建。
      projection.sessionInitialized ||= resumable;
      await this.config.history.saveMetadata(id, projection.metadata());
      await session.checkpoint(id, projection, this.config);
      const inputStream = session.createInput();
      const stream = createClaudeQuery({
        sdk: this.sdk,
        config: this.config,
        task,
        options,
        defaults,
        permissionMode,
        controller,
        permissions,
        grants,
        sessionId,
        resumable,
        inputStream,
        outputSchema: input.outputSchema,
        getRunning: () => this.#running.get(id),
      });
      const running: session.Running = {
        sessionId,
        query: stream,
        projection,
        controller,
        permissions: new Map([[turnId, permissions]]),
        projections: new Map([[turnId, projection]]),
        itemChanges: new Map([[turnId, itemChanges]]),
        backgroundTasks: projection.backgroundTasks,
        createPermissions: (nextTurnId) =>
          new ClaudePermissions(this.scope.id, id, nextTurnId, this.#emit, grants),
        input: inputStream,
        settingsKey,
        settings,
        grants,
        done: Promise.resolve(),
        idleTimeoutMs: this.idleTimeoutMs,
      };
      let writing = false;
      running.timer = setInterval(() => {
        if (writing || !session.hasWork(running)) return;
        writing = true;
        void session
          .persist(id, running, this.config)
          .catch(() => {
            session.stop(running);
          })
          .finally(() => {
            writing = false;
          });
      }, 2_000);
      running.timer.unref();
      this.#running.set(id, running);
      this.#emit({
        type: "turn.started",
        taskId: id,
        turnId,
        payload: { turn: projection.snapshot() },
      });
      inputStream.send(prompt);
      this.#titles.start(task, input);
      running.done = session.consume(id, running, this.config, this.store, this.#emit, (turn) => {
        if (this.config.persistence.hasPending(id))
          this.#markUnpersisted(id, turn.persistence?.error ?? null);
        else this.#unpersisted.delete(id);
        this.#recent.delete(id);
        this.#recent.set(id, turn);
        // 缓存仅跨越终态与历史读取的窗口，不持有已结束查询或完整 SDK 历史。
        while (this.#recent.size > 8) {
          const oldest = this.#recent.keys().next().value;
          if (oldest !== undefined) this.#recent.delete(oldest);
        }
        this.#running.delete(id);
      });
      return projection.snapshot();
    } finally {
      this.#starting.delete(id);
      const running = this.#running.get(id);
      if (running) session.scheduleIdle(running, this.idleTimeoutMs);
    }
  }
  /** 原生 task_id 与本地聊天 ID 分离，停止单个后台任务不关闭会话。 */
  async stopBackgroundTask(id: string, backgroundTaskId: string): Promise<void> {
    await this.#task(id);
    const running = this.#running.get(id);
    if (!running?.backgroundTasks.has(backgroundTaskId))
      throw new Error("Claude background task is no longer running");
    await running.query.stopTask(backgroundTaskId);
  }
  async stopSession(id: string, backgroundTaskId?: string): Promise<void> {
    if (backgroundTaskId) return this.stopBackgroundTask(id, backgroundTaskId);
    await this.#task(id);
    const running = this.#running.get(id);
    if (!running) return;
    session.stop(running);
    await running.done;
  }
  async interruptTurn(id: string, turnId: string): Promise<void> {
    await this.#task(id);
    const current = this.#running.get(id);
    if (!current || current.projection.id !== turnId || current.projection.status !== "running")
      throw new Error("Claude turn is no longer running");
    await interruptForeground(current, id, (listener) => this.subscribeEvents(listener));
  }
  async resolvePendingRequest(input: ResolvePendingRequestInput) {
    await this.#task(input.taskId);
    const current = this.#running.get(input.taskId);
    if (!current) throw new Error("Claude turn is no longer running");
    const permissions = current.permissions.get(input.turnId);
    if (!permissions) throw new Error("Claude turn is no longer available");
    return permissions.resolve(input);
  }
  close(): void {
    this.#titles.close();
    this.#mcp.close();
    for (const current of this.#running.values()) {
      session.stop(current);
    }
    this.#recent.clear();
    this.#sessionGrants.clear();
    this.#listeners.clear();
  }
}
