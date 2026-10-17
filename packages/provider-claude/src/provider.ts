import { localTaskMetadata as claudeTask } from "@codexly/core";
export { localTaskMetadata as claudeTask } from "@codexly/core";
import { mapClaudeMcpServers, observe } from "./observability.js";
import { isManagedClaudeCommand } from "./commands.js";
import { deleteClaudeTask } from "./task-deletion.js";
import { randomUUID } from "node:crypto";
import {
  query,
  getSessionMessages,
  getSessionInfo,
  deleteSession,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentProviderEventListener,
  AgentProviderTurnInput,
  AgentProviderTaskSnapshot,
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
export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  provider: "claude",
  feedback: { upload: false },
  goals: { clear: false, read: false, update: false },
  skills: { list: false, use: false },
  tasks: { fork: false, list: true, read: true, start: true },
  turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
};
export type { ClaudeSdk } from "./session.js";
export class ClaudeAgentProvider {
  readonly #listeners = new Set<AgentProviderEventListener>();
  readonly #running = new Map<string, session.Running>();
  readonly #starting = new Set<string>();
  readonly #recent = new Map<string, AgentTurn>();
  readonly #unpersisted = new Set<string>();
  readonly #sessionGrants = new Map<string, ClaudeSessionGrants>();
  constructor(
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly config: ClaudeConfiguration,
    readonly sdk: session.ClaudeSdk = { query, getSessionMessages, getSessionInfo, deleteSession },
    readonly discover?: () => Promise<AgentEngineProfile>,
    readonly idleTimeoutMs = 30_000,
  ) {}
  get isBusy() {
    return (
      this.#starting.size > 0 ||
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
  async listMcpServers(id: string) {
    await this.#task(id);
    const running = this.#running.get(id);
    if (running && typeof running.query.mcpServerStatus === "function") {
      const servers = await observe(() => running.query.mcpServerStatus());
      if (servers) running.projection.mcpServers = mapClaudeMcpServers(servers);
    }
    return {
      data:
        running?.projection.mcpServers ??
        (await this.config.history.metadata(id))?.mcpServers ??
        [],
    };
  }
  async reloadMcpServers(id: string) {
    await this.#task(id);
    const running = this.#running.get(id);
    if (running) {
      const { data } = await this.listMcpServers(id);
      await Promise.all(
        data
          .filter(
            (server) => server.status === "failed" || server.status === "authenticationRequired",
          )
          .map((server) => running.query.reconnectMcpServer(server.name)),
      );
    }
    return this.listMcpServers(id);
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
    await this.store.catalog("task.patch", { id, title });
    this.#emit({ type: "task.metadata_changed", taskId: id, payload: {} });
  }
  async archiveTask(id: string) {
    await this.#task(id);
    const running = this.#running.get(id);
    if (running && (running.settling || session.hasWork(running)))
      throw new Error("Stop the running task before archiving");
    if (running) await this.stopSession(id);
    await this.store.catalog("task.patch", { id, archived: true });
    this.#sessionGrants.delete(id);
    this.#emit({ type: "task.removed", taskId: id, payload: { reason: "archived" } });
  }
  async unarchiveTask(id: string) {
    await this.#task(id);
    return claudeTask(await this.store.catalog("task.patch", { id, archived: false }));
  }
  async deleteTask(id: string) {
    await deleteClaudeTask(await this.#task(id), this, this.#starting, this.#running);
    this.#sessionGrants.delete(id);
    this.#recent.delete(id);
    this.#unpersisted.delete(id);
    this.#emit({ type: "task.removed", taskId: id, payload: { reason: "deleted" } });
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
    const task: LocalTask = {
      id: `task-${randomUUID()}`,
      provider: "claude",
      sessionId: null,
      projectId: this.scope.kind === "temporary" ? null : this.scope.id,
      cwd: options.workspacePath ?? this.scope.rootPath,
      title: "",
      updatedAt: Date.now() / 1000,
      pinned: false,
      archived: false,
      status: "notLoaded",
    };
    return claudeTask(await this.store.catalog("task.put", task));
  }
  async readTaskMetadata(id: string): Promise<AgentTask | undefined> {
    const task = await this.store.catalog("task.read", { id });
    return task?.provider === "claude" &&
      task.projectId === (this.scope.kind === "temporary" ? null : this.scope.id)
      ? claudeTask(task)
      : undefined;
  }
  async readTask(
    id: string,
    input: ReadAgentTaskInput = {},
  ): Promise<AgentProviderTaskSnapshot | undefined> {
    const task = await this.#task(id);
    // 显式读取也是恢复入口；即使旧查询已经退出，也不能让最近回合缓存掩盖写盘故障。
    const recovery = await this.config.persistence.retry(id);
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
  async startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
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
      const recovery = await this.config.persistence.retry(id);
      if (recovery?.pending) throw new Error("Claude 历史持久化尚未完成，请修复存储后重试");
      this.#unpersisted.delete(id);
      const defaults = await this.config.readSettings();
      if (task.archived) throw new Error("Cannot run an archived task");
      if (isManagedClaudeCommand(input.text))
        throw new Error("This command is unavailable in managed Claude conversations");
      if (options.goalMode || options.fastMode || input.outputSchema || input.skills.length)
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
      );
      const metadata = await this.config.history.metadata(id);
      projection.restoreMetadata(metadata);
      const grants = this.#sessionGrants.get(id) ?? new ClaudeSessionGrants(permissionMode);
      // 各回合共享同一授权集合，后台旧回合的迟到审批也只合并到当前聊天。
      this.#sessionGrants.set(id, grants);
      const permissions = new ClaudePermissions(this.scope.id, id, turnId, this.#emit, grants);
      const controller = new AbortController();
      const settingsKey = JSON.stringify({ options, defaults });
      let existing = this.#running.get(id);
      if (existing?.closed) {
        await existing.done;
        existing = undefined;
      }
      if (existing && existing.settingsKey !== settingsKey) {
        if (session.hasWork(existing))
          throw new Error("Stop Claude background tasks before changing session options");
        session.stop(existing);
        await existing.done;
        existing = undefined;
      }
      if (existing && existing.projections.size >= 64)
        throw new Error("Claude background turn capacity exceeded");
      const resumable =
        !existing && (await session.canResume(task, this.sdk, this.config.history, metadata));
      // 原生恢复校验通过后先幂等归档崩溃检查点，避免新回合覆盖后丢失界面历史。
      if (!existing) await this.config.history.archiveActive(id);
      // 发送前持久绑定精确 UUID；进程重启或请求重试不能改绑到另一个会话。
      await this.store.catalog("task.patch", {
        id,
        sessionId,
        status: "active",
        updatedAt: Date.now() / 1000,
        ...(!task.title ? { title: input.text.trim().slice(0, 80) || "新聊天" } : {}),
      });
      if (existing) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = undefined;
        projection.restoreMetadata(existing.projection.metadata());
        await this.config.history.checkpoint(id, projection.snapshot());
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
        return projection.snapshot();
      }
      // 启动失败但未收到 SDK 消息时保留 false，允许下次仍以原 UUID 首次创建。
      projection.sessionInitialized ||= resumable;
      await this.config.history.saveMetadata(id, projection.metadata());
      await this.config.history.checkpoint(id, projection.snapshot());
      const inputStream = session.createInput();
      const stream = this.sdk.query({
        prompt: inputStream,
        options: {
          cwd: task.cwd,
          // 两端都提供计划面板，显式启用任务工具；不改写用户配置或自动放行工具权限。
          env: { ...this.config.environment(), CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" },
          // default 保留 SDK 对本机及项目模型配置的解析，不传 CLI 的 --model 覆盖。
          ...(options.model && options.model !== "default" ? { model: options.model } : {}),
          permissionMode,
          allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
          hooks: session.wakeupHooks(() => this.#running.get(id)),
          includePartialMessages: true,
          persistSession: true,
          abortController: controller,
          // SDK 先执行原生 Elicitation Hook，仅未处理的请求进入两端共用交互。
          // 回调没有工具/代理身份，绑定调用时的当前回合，不能捕获首次启动的旧回合。
          onElicitation: (request, elicitationOptions) => {
            const active = this.#running.get(id);
            return (
              active?.permissions.get(active.projection.id) ?? permissions
            ).elicitation.request(request, elicitationOptions);
          },
          canUseTool: (name, input, toolOptions) => {
            const active = this.#running.get(id);
            const owner = [...(active?.projections.values() ?? [])].find((candidate) =>
              candidate.ownsMessage({
                tool_use_id: toolOptions.toolUseID,
                agent_id: toolOptions.agentID,
              }),
            );
            return (
              active?.permissions.get(owner?.id ?? active.projection.id) ?? permissions
            ).request(name, input, toolOptions);
          },
          settingSources: defaults.loadProjectSettings ? ["user", "project", "local"] : ["user"],
          // 原生 allow/deny 由 settingSources 保留路径基准；SDK 参数仅重放当前聊天授权。
          ...grants.options(permissionMode),
          ...(["low", "medium", "high", "xhigh", "max"].includes(options.reasoningEffort)
            ? { effort: options.reasoningEffort as "low" | "medium" | "high" | "xhigh" | "max" }
            : {}),
          // 全局指令由 SDK 从用户 CLAUDE.md 加载，避免再 append 一次造成重复。
          systemPrompt: { type: "preset", preset: "claude_code" },
          ...(resumable ? { resume: sessionId } : { sessionId }),
        },
      });
      const running: session.Running = {
        sessionId,
        query: stream,
        projection,
        controller,
        permissions: new Map([[turnId, permissions]]),
        projections: new Map([[turnId, projection]]),
        itemChanges: new Map([[turnId, itemChanges]]),
        backgroundTasks: new Set(),
        createPermissions: (nextTurnId) =>
          new ClaudePermissions(this.scope.id, id, nextTurnId, this.#emit, grants),
        input: inputStream,
        settingsKey,
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
    await Promise.race([
      current.query.interrupt(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        timer.unref();
      }),
    ]);
    session.stop(current);
    await current.done;
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
    for (const current of this.#running.values()) {
      session.stop(current);
    }
    this.#recent.clear();
    this.#sessionGrants.clear();
    this.#listeners.clear();
  }
}
