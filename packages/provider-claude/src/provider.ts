import { isManagedClaudeCommand } from "./commands.js";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  query,
  getSessionMessages,
  getSessionInfo,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentProviderEventListener,
  AgentProviderTurnInput,
  AgentProviderTaskSnapshot,
  AgentTaskScope,
  LocalCatalogStore,
  LocalTask,
  AgentProviderEvent,
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
import { ClaudeTurnProjection, record } from "./turn-projection.js";

export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  provider: "claude",
  feedback: { upload: false },
  goals: { clear: false, read: false, update: false },
  skills: { list: false, use: false },
  tasks: { fork: false, list: true, read: true, start: true },
  turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
};

export interface ClaudeSdk {
  query: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
  getSessionMessages: typeof getSessionMessages;
  getSessionInfo?: typeof getSessionInfo;
}
interface Running {
  sessionId: string;
  query: Query;
  projection: ClaudeTurnProjection;
  permissions: ClaudePermissions;
  controller: AbortController;
  release: () => void;
  terminal?: AgentProviderEvent | undefined;
  timer?: ReturnType<typeof setInterval>;
}

export function claudeTask(task: LocalTask): AgentTask {
  return {
    id: task.id,
    projectId: task.projectId ?? "temporary",
    engine: "claude",
    title: task.title || "新聊天",
    pinned: task.pinned,
    updatedAt: new Date(task.updatedAt * 1000).toISOString(),
    workspacePath: task.cwd,
  };
}

export class ClaudeAgentProvider {
  readonly #listeners = new Set<AgentProviderEventListener>();
  readonly #running = new Map<string, Running>();
  readonly #starting = new Set<string>();
  readonly #recent = new Map<string, AgentTurn>();
  constructor(
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly config: ClaudeConfiguration,
    readonly sdk: ClaudeSdk = { query, getSessionMessages, getSessionInfo },
    readonly discover?: () => Promise<AgentEngineProfile>,
  ) {}

  get isBusy() {
    return this.#running.size > 0 || this.#starting.size > 0;
  }

  async listModels() {
    if (!this.discover) throw new Error("Claude model discovery unavailable");
    return (await this.discover()).models;
  }
  listSkills() {
    return Promise.resolve({ data: [], nextCursor: null });
  }
  listMcpServers() {
    return Promise.resolve({ data: [], nextCursor: null });
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
    return Promise.resolve(this.#running.has(id) ? ("busy" as const) : ("notLoaded" as const));
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
    if (this.#running.has(id)) throw new Error("Stop the running task before archiving");
    await this.store.catalog("task.patch", { id, archived: true });
    this.#emit({ type: "task.removed", taskId: id, payload: { reason: "archived" } });
  }
  async unarchiveTask(id: string) {
    await this.#task(id);
    return claudeTask(await this.store.catalog("task.patch", { id, archived: false }));
  }
  async deleteTask(id: string) {
    await this.#task(id);
    if (this.#running.has(id)) throw new Error("Stop the running task before deleting");
    await this.store.catalog("task.remove", { id });
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
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: current?.permissions.pending() ?? [],
      status: current
        ? "running"
        : last?.status === "failed" || task.status === "failed"
          ? "failed"
          : "idle",
      threadConfiguration: { model: null, reasoningEffort: null },
      turns,
      turnsNextCursor: nextCursor,
    };
  }

  async startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    if (this.#starting.has(id) || this.#running.has(id))
      throw new Error("A Claude turn is already running");
    if (this.#starting.size + this.#running.size >= 8)
      throw new Error("Claude concurrent turn capacity exceeded");
    this.#starting.add(id);
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
      let terminal: AgentProviderEvent | undefined;
      const projection = new ClaudeTurnProjection(id, turnId, input.text, (event) => {
        if (event.type === "turn.completed") terminal = event;
        else this.#emit(event);
      });
      const permissions = new ClaudePermissions(this.scope.id, id, turnId, this.#emit);
      const controller = new AbortController(),
        gate = Promise.withResolvers<undefined>();
      const content: Exclude<SDKUserMessage["message"]["content"], string> = [
        { type: "text", text: input.text || " " },
      ];
      for (const attachment of input.textAttachments)
        content.push({ type: "text", text: `${attachment.name}\n${attachment.text}` });
      for (const file of input.files)
        content.push({ type: "text", text: `Attached file: ${file.path}` });
      let imageBytes = 0;
      for (const image of input.images) {
        const size = (await stat(image.path)).size;
        imageBytes += size;
        if (size > 5 * 1024 * 1024 || imageBytes > 20 * 1024 * 1024)
          throw new Error("Claude images are limited to 5 MiB each and 20 MiB per turn");
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mediaType,
            data: (await readFile(image.path)).toString("base64"),
          },
        });
      }
      const prompt: SDKUserMessage = {
        type: "user",
        uuid: turnId,
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: "user", content },
      };
      // 发送前持久绑定精确 UUID；进程重启或请求重试不能改绑到另一个会话。
      await this.store.catalog("task.patch", {
        id,
        sessionId,
        status: "active",
        updatedAt: Date.now() / 1000,
        ...(!task.title ? { title: input.text.trim().slice(0, 80) || "新聊天" } : {}),
      });
      const resumable =
        task.sessionId &&
        (this.sdk.getSessionInfo
          ? await this.sdk.getSessionInfo(task.sessionId, { dir: task.cwd })
          : true);
      await this.config.history.checkpoint(id, projection.snapshot());
      const stream = this.sdk.query({
        prompt: (async function* () {
          yield prompt;
          await gate.promise;
        })(),
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
          canUseTool: permissions.request,
          settingSources: defaults.loadProjectSettings ? ["user", "project", "local"] : ["user"],
          allowedTools: defaults.allowedTools,
          disallowedTools: defaults.disallowedTools,
          ...(["low", "medium", "high", "xhigh", "max"].includes(options.reasoningEffort)
            ? { effort: options.reasoningEffort as "low" | "medium" | "high" | "xhigh" | "max" }
            : {}),
          // 全局指令由 SDK 从用户 CLAUDE.md 加载，避免再 append 一次造成重复。
          systemPrompt: { type: "preset", preset: "claude_code" },
          ...(resumable ? { resume: sessionId } : { sessionId }),
        },
      });
      const running: Running = {
        sessionId,
        query: stream,
        projection,
        permissions,
        controller,
        release: () => {
          gate.resolve(undefined);
        },
        get terminal() {
          return terminal;
        },
      };
      let writing = false;
      running.timer = setInterval(() => {
        if (writing) return;
        writing = true;
        void this.config.history
          .checkpoint(id, projection.snapshot())
          .catch(() => {
            controller.abort();
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
      void this.#consume(id, running);
      return projection.snapshot();
    } finally {
      this.#starting.delete(id);
    }
  }

  async #consume(id: string, running: Running): Promise<void> {
    try {
      for await (const message of running.query) {
        const actualSession = record(message)["session_id"];
        if (
          typeof actualSession === "string" &&
          actualSession &&
          actualSession !== running.sessionId
        )
          throw new Error("Claude changed the bound session identity");
        running.projection.receive(message);
        if (running.projection.status !== "running") break;
      }
      if (running.projection.status === "running")
        running.projection.finish(
          running.controller.signal.aborted ? "interrupted" : "failed",
          running.controller.signal.aborted ? undefined : "Claude stream ended without a result",
        );
    } catch (error) {
      running.projection.finish(
        running.controller.signal.aborted ? "interrupted" : "failed",
        error instanceof Error ? error.message : "Claude execution failed",
      );
    } finally {
      clearInterval(running.timer);
      running.permissions.close();
      running.release();
      try {
        running.query.close();
      } catch {
        /* 进程已关闭仍必须完成状态清理。 */
      }
      const turn = running.projection.snapshot();
      this.#recent.delete(id);
      this.#recent.set(id, turn);
      // 仅缓存少量最近回合用于消除终态与落盘之间的窗口；长期历史由 SDK 按需读取。
      while (this.#recent.size > 8) {
        const oldest = this.#recent.keys().next().value;
        if (oldest !== undefined) this.#recent.delete(oldest);
      }
      await this.config.history.complete(id, turn).catch(() => undefined);
      this.#running.delete(id);
      await this.store
        .catalog("task.patch", {
          id,
          status: turn.status === "failed" ? "failed" : "idle",
          updatedAt: Date.now() / 1000,
        })
        .catch(() => undefined);
      // 先释放运行锁并落盘，再发布终态；排队发送可以立即启动下一回合。
      if (running.terminal) this.#emit(running.terminal);
    }
  }

  async interruptTurn(id: string, turnId: string): Promise<void> {
    await this.#task(id);
    const current = this.#running.get(id);
    if (!current || current.projection.id !== turnId)
      throw new Error("Claude turn is no longer running");
    await Promise.race([
      current.query.interrupt(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        timer.unref();
      }),
    ]);
    current.projection.finish("interrupted");
    current.permissions.close();
    current.controller.abort();
    current.release();
    current.query.close();
  }

  async resolvePendingRequest(input: ResolvePendingRequestInput) {
    await this.#task(input.taskId);
    const current = this.#running.get(input.taskId);
    if (!current) throw new Error("Claude turn is no longer running");
    return current.permissions.resolve(input);
  }

  close(): void {
    for (const current of this.#running.values()) {
      current.controller.abort();
      current.permissions.close();
      current.release();
      current.query.close();
    }
    this.#recent.clear();
    this.#listeners.clear();
  }
}
