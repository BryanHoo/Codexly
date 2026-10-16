import { localTaskMetadata as claudeTask } from "@codexly/core";
export { localTaskMetadata as claudeTask } from "@codexly/core";
import { mapClaudeMcpServers, observe } from "./observability.js";
import { isManagedClaudeCommand } from "./commands.js";
import { randomUUID } from "node:crypto";
import { query, getSessionMessages, getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
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
import { createClaudePrompt } from "./turn-input.js";
import { ClaudeTurnProjection } from "./turn-projection.js";

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
  readonly #sessionGrants = new Map<string, ClaudeSessionGrants>();
  constructor(
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly config: ClaudeConfiguration,
    readonly sdk: session.ClaudeSdk = { query, getSessionMessages, getSessionInfo },
    readonly discover?: () => Promise<AgentEngineProfile>,
    readonly idleTimeoutMs = 30_000,
  ) {}

  get isBusy() {
    return (
      this.#starting.size > 0 ||
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
  readTaskAttachment() {
    return Promise.resolve(undefined);
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
    await this.#task(id);
    const running = this.#running.get(id);
    if (running && (running.settling || session.hasWork(running)))
      throw new Error("Stop the running task before deleting");
    if (running) await this.stopSession(id);
    await this.store.catalog("task.remove", { id });
    this.#sessionGrants.delete(id);
    this.#recent.delete(id);
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
    for (const listener of this.#listeners) listener(event);
  };

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
    const current = this.#running.get(id),
      last = current?.projection.snapshot() ?? this.#recent.get(id);
    const page = await this.config.history.read(id, input.cursor);
    const turns = page.turns;
    const nextCursor = page.cursor;
    if (current && input.cursor === undefined) {
      for (const projection of current.projections.values()) {
        const turn = projection.snapshot();
        const index = turns.findIndex((entry) => entry.id === turn.id);
        if (index >= 0) turns[index] = turn;
        else turns.push(turn);
      }
    }
    const metadata = current?.projection.metadata() ?? (await this.config.history.metadata(id));
    if (!current && input.cursor === undefined) {
      const recovered = await this.config.history.active(id);
      if (recovered && !turns.some((turn) => turn.id === recovered.id))
        turns.push({
          ...recovered,
          status: "failed",
          error: "Claude process ended before completing this turn",
          completedAt: null,
        });
    }
    if (!current && !this.#starting.has(id) && task.status === "active") {
      // 宿主异常退出后解除过期运行标记，保留检查点并允许重试或删除该任务。
      task.status = turns.at(-1)?.status === "completed" ? "idle" : "failed";
      await this.store.catalog("task.patch", { id, status: task.status });
    }
    if (last && input.cursor === undefined) {
      const index = turns.findIndex((turn) => turn.id === last.id);
      if (index >= 0) turns[index] = last;
      else turns.push(last);
    }
    return {
      ...claudeTask(task),
      contextUsage: metadata?.contextUsage ?? null,
      goal: null,
      plan: metadata?.plan ?? null,
      pendingRequests: current
        ? [...current.permissions.values()].flatMap((permissions) => permissions.pending())
        : [],
      status:
        current?.projection.status === "running"
          ? "running"
          : last?.status === "failed" || task.status === "failed"
            ? "failed"
            : "idle",
      threadConfiguration: { model: metadata?.model ?? null, reasoningEffort: null },
      turns,
      turnsNextCursor: nextCursor,
    };
  }

  async startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
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
      const defaults = await this.config.readSettings();
      if (task.archived) throw new Error("Cannot run an archived task");
      if (isManagedClaudeCommand(input.text))
        throw new Error("This command is unavailable in managed Claude conversations");
      if (options.goalMode || options.fastMode || input.outputSchema || input.skills.length)
        throw new Error("This capability is not supported by the Claude adapter");
      const permissionMode = options.engineOptions?.permissionMode ?? defaults.permissionMode;
      const sessionId = task.sessionId ?? randomUUID(),
        turnId = randomUUID();
      const projection = new ClaudeTurnProjection(id, turnId, input.text, (event) => {
        // 完成事件由消费器在回合落盘之后发布，不能等待整个会话退出。
        if (event.type !== "turn.completed") this.#emit(event);
      });
      projection.restoreMetadata(await this.config.history.metadata(id));
      const grants = this.#sessionGrants.get(id) ?? new ClaudeSessionGrants(permissionMode);
      // 各回合共享同一授权集合，后台旧回合的迟到审批也只合并到当前聊天。
      this.#sessionGrants.set(id, grants);
      const permissions = new ClaudePermissions(this.scope.id, id, turnId, this.#emit, grants);
      const controller = new AbortController();
      const prompt = await createClaudePrompt(input, sessionId, turnId);
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
      const resumable =
        task.sessionId &&
        (this.sdk.getSessionInfo
          ? await this.sdk.getSessionInfo(task.sessionId, { dir: task.cwd })
          : true);
      await this.config.history.checkpoint(id, projection.snapshot());
      const inputStream = session.createInput();
      const stream = this.sdk.query({
        prompt: inputStream,
        options: {
          cwd: task.cwd,
          env: this.config.environment(),
          // default 保留 SDK 对本机及项目模型配置的解析，不传 CLI 的 --model 覆盖。
          ...(options.model && options.model !== "default" ? { model: options.model } : {}),
          permissionMode,
          allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
          includePartialMessages: true,
          persistSession: true,
          abortController: controller,
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
          ...grants.options(defaults.allowedTools, permissionMode),
          disallowedTools: defaults.disallowedTools,
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
        backgroundTasks: new Set(),
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
