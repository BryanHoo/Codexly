import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpTaskManagement } from "./task-management.js";
import { readAcpTaskSnapshot } from "./task-snapshot.js";
import {
  AgentTurnNotSubmittedError,
  type AgentExecutionAdapter,
  type AgentTaskScope,
  type LocalCatalogStore,
  type LocalTask,
  type AgentProviderEventListener,
  type AgentProviderTurnInput,
  type StartAgentTaskOptions,
  type ReadAgentTaskInput,
  type AgentProviderTaskSnapshot,
  type ResolvePendingRequestInput,
  type AgentProviderEventSubscriptionOptions,
} from "@codexly/core";
import type { AcpConfigValues, AgentEngine, AgentTurnOptions, AgentTurn } from "@codexly/protocol";
import type { SessionNotification, SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import type { AcpConnection, AcpClientCallbacks } from "./connection.js";
import type { AcpHistory } from "./history.js";
import { AcpReplay } from "./replay.js";
import { AcpEventProjection } from "./event-projection.js";
import { AcpPermissions } from "./permissions.js";
import { createAcpPrompt } from "./turn-input.js";
import { acpCapabilities, discoverAcpModels } from "./provider-discovery.js";
import { migrateAcpSettings } from "./migration.js";
import { applyAcpConfig } from "./configuration.js";
import { submitAcpTurn } from "./turn-submission.js";
import { startAcpLocalTask } from "./task-creation.js";
import { generateAcpText } from "./text-generation.js";
import type { AcpSessionMetadata } from "./session-metadata.js";

/** 同一实现接入任意 ACP agent；应用任务管理与 agent 的原生会话身份保持分离。 */
export class AcpAgentProvider implements AgentExecutionAdapter {
  readonly #listeners = new Map<AgentProviderEventListener, boolean>();
  readonly #ephemeral = new Map<string, LocalTask>();
  readonly #taskSettlements = new Map<string, Promise<void>>();
  readonly #sessions = new Map<string, string>();
  #agentInstance: AcpConnection | undefined;
  readonly #needsDefaults = new Set<string>();
  readonly #replays = new Map<string, AcpReplay>();
  readonly #active = new Map<string, AcpEventProjection>();
  readonly #settlements = new Set<Promise<void>>();
  readonly #operations = new Map<string, Promise<unknown>>();
  #connection: Promise<AcpConnection> | undefined;
  #closed = false;
  readonly #permissions: AcpPermissions;
  readonly attachments: HistoricalTaskAttachments;
  readonly #management: AcpTaskManagement;
  prepareTaskTitle?: (task: LocalTask, input: AgentProviderTurnInput) => Promise<void>;
  publishTaskTitle(id: string, title: string): void {
    this.#emit({ type: "task.metadata_changed", taskId: id, payload: { title } });
  }
  constructor(
    readonly engine: AgentEngine,
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly history: AcpHistory,
    readonly connect: (callbacks: AcpClientCallbacks) => Promise<AcpConnection>,
    readonly initializeSession?: (
      connection: AcpConnection,
      sessionId: string,
      options: SessionConfigOption[],
    ) => Promise<SessionConfigOption[]>,
  ) {
    this.attachments = new HistoricalTaskAttachments(join(history.directory, "task-attachments"));
    this.#permissions = new AcpPermissions(scope.id, this.#emit);
    this.#management = new AcpTaskManagement(
      engine,
      scope.kind === "temporary" ? null : scope.id,
      store,
      (id) => this.#active.has(id),
      async (task) => {
        if (task.sessionId) {
          const agent = await this.#agent();
          if (!agent.initialization.agentCapabilities?.sessionCapabilities?.delete)
            throw new Error("ACP agent 不支持原生会话删除");
          try {
            await agent.transport.agent.request(acp.methods.agent.session.delete, {
              sessionId: task.sessionId,
            });
          } catch (error) {
            if (!(error instanceof acp.RequestError) || error.code !== -32002) throw error;
          }
          agent.forgetSession(task.sessionId);
        }
        this.#sessions.delete(task.id);
        this.#needsDefaults.delete(task.id);
      },
      async (id) => {
        await history.deleteTask(id);
        await this.attachments.deleteTask(id);
      },
      this.#emit,
    );
  }
  subscribeEvents(
    listener: AgentProviderEventListener,
    options?: AgentProviderEventSubscriptionOptions,
  ): () => void {
    this.#listeners.set(listener, options?.includeEphemeral === true);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  readonly #emit: AgentProviderEventListener = (event) => {
    for (const [listener, include] of this.#listeners)
      if (!this.#ephemeral.has(event.taskId) || include)
        listener({ ...event, provider: this.engine });
  };
  async #task(id: string): Promise<LocalTask> {
    const task = this.#ephemeral.get(id) ?? (await this.store.catalog("task.read", { id }));
    if (
      !task ||
      task.provider !== this.engine ||
      task.projectId !== (this.scope.kind === "temporary" ? null : this.scope.id)
    )
      throw new Error("任务不属于当前项目或引擎");
    return task;
  }
  async #patch(id: string, patch: Partial<LocalTask>): Promise<void> {
    const task = this.#ephemeral.get(id);
    if (task) {
      this.#ephemeral.set(id, { ...task, ...patch });
      return;
    }
    await this.store.catalog("task.patch", { ...patch, id });
  }
  #serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("ACP Provider 已关闭"));
    const operation = (this.#operations.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    this.#operations.set(id, operation);
    void operation
      .finally(() => {
        if (this.#operations.get(id) === operation) this.#operations.delete(id);
      })
      .catch(() => undefined);
    return operation;
  }
  #agent(): Promise<AcpConnection> {
    if (this.#closed) return Promise.reject(new Error("ACP Provider 已关闭"));
    if (!this.#connection) {
      const pending = this.connect({
        onSessionState: (sessionId, state) => {
          this.#emitSessionState(sessionId, state);
        },
        onUpdate: (notification) => this.#update(notification),
        requestPermission: (request, signal) => {
          const task = [...this.#sessions].find(([, id]) => id === request.sessionId)?.[0];
          const active = task ? this.#active.get(task) : undefined;
          return task && active && !this.#ephemeral.has(task)
            ? this.#permissions.request(task, active.turnId, request, signal)
            : Promise.resolve({ outcome: { outcome: "cancelled" as const } });
        },
      });
      this.#connection = pending;
      void pending
        .then((connection) => {
          if (this.#connection === pending) this.#agentInstance = connection;
          return connection.closed;
        })
        .catch(() => undefined)
        .then(() => {
          if (this.#connection === pending) {
            this.#connection = undefined;
            this.#agentInstance = undefined;
            this.#sessions.clear();
            this.#needsDefaults.clear();
          }
        });
    }
    return this.#connection;
  }
  async #update(notification: SessionNotification): Promise<void> {
    const replay = this.#replays.get(notification.sessionId);
    if (replay) {
      await replay.update(notification.update);
      return;
    }
    const task = [...this.#sessions].find(([, session]) => session === notification.sessionId)?.[0];
    if (!task) return;
    this.#active.get(task)?.update(notification.update);
  }
  #emitSessionState(sessionId: string, state: AcpSessionMetadata): void {
    const task = [...this.#sessions].find(([, native]) => native === sessionId)?.[0];
    if (task) this.#emit({ type: "acp.session.updated", taskId: task, payload: { state } });
  }
  async #load(task: LocalTask, explicitConfig = false): Promise<AcpConnection> {
    const connection = await this.#agent();
    const bound = this.#sessions.get(task.id);
    if (bound) {
      // 创建成功但目录写入失败时，重试先确认同一绑定，禁止重新创建或提交未绑定会话。
      if (task.sessionId !== bound) await this.#patch(task.id, { sessionId: bound });
      if (!explicitConfig) await this.#initialize(task.id, connection, bound);
      return connection;
    }
    if (this.#sessions.size >= 64) throw new Error("ACP 活跃会话达到容量限制");
    if (
      this.#ephemeral.has(task.id) &&
      !connection.initialization.agentCapabilities?.sessionCapabilities?.close
    )
      throw new Error("ACP agent 不支持辅助会话关闭");
    if (task.sessionId === null) {
      const session = await connection.newSession({ cwd: task.cwd, mcpServers: [] });
      this.#sessions.set(task.id, session.sessionId);
      this.#needsDefaults.add(task.id);
      await this.#patch(task.id, { sessionId: session.sessionId });
      if (!explicitConfig) await this.#initialize(task.id, connection, session.sessionId);
      this.#emitSessionState(session.sessionId, connection.readSessionState(session.sessionId));
    } else {
      const replay = new AcpReplay(this.history, task.id);
      this.#replays.set(task.sessionId, replay);
      try {
        await connection.loadSession({
          sessionId: task.sessionId,
          cwd: task.cwd,
          mcpServers: [],
        });
        await replay.complete();
        this.#sessions.set(task.id, task.sessionId);
        this.#emitSessionState(task.sessionId, connection.readSessionState(task.sessionId));
      } catch (error) {
        await replay.abort(error);
        throw error;
      } finally {
        this.#replays.delete(task.sessionId);
      }
    }
    return connection;
  }
  async #initialize(id: string, connection: AcpConnection, sessionId: string): Promise<void> {
    if (!this.#needsDefaults.has(id)) return;
    // 绑定先落盘；失败保留待应用标记，当前进程内安全重试同一会话。
    const options = connection.readSessionState(sessionId).configOptions;
    const initialized = await this.initializeSession?.(connection, sessionId, options);
    if (initialized) await connection.cacheSessionConfiguration(sessionId, initialized);
    this.#needsDefaults.delete(id);
  }
  async startTask(options: StartAgentTaskOptions = {}) {
    if (this.#closed) throw new Error("ACP Provider 已关闭");
    return startAcpLocalTask(this.engine, this.scope, options, this.store, this.#ephemeral);
  }
  readTask(id: string, input: ReadAgentTaskInput = {}): Promise<AgentProviderTaskSnapshot> {
    return this.#serial(id, async () => {
      input.signal?.throwIfAborted();
      const task = await this.#task(id);
      return readAcpTaskSnapshot(task, input, {
        engine: this.engine,
        history: this.history,
        load: () => this.#load(task),
        active: () => this.#active.get(id),
        pending: () => this.#permissions.list(id),
        sessionState: () => {
          const session = this.#sessions.get(id);
          return session ? this.#agentInstance?.readSessionState(session) : undefined;
        },
      });
    });
  }
  startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    return this.#startTurn(id, input, options);
  }
  #startTurn(
    id: string,
    input: AgentProviderTurnInput,
    options: Partial<Pick<AgentTurnOptions, "model" | "reasoningEffort">>,
    signal?: AbortSignal,
    initialConfig?: AcpConfigValues,
  ): Promise<AgentTurn> {
    return submitAcpTurn((submitted) =>
      this.#serial(id, async () => {
        if (this.#active.has(id))
          throw new AgentTurnNotSubmittedError("任务已有运行中或待持久化回合");
        const task = await this.#task(id);
        const agent = await this.#agent();
        const prompt = await createAcpPrompt(
          input,
          agent.initialization.agentCapabilities?.promptCapabilities ?? {},
          join(
            this.history.directory,
            "attachments",
            createHash("sha256").update(id).digest("hex"),
          ),
        );
        const attachments = await this.attachments.prepare(id, input);
        await this.#load(task, initialConfig !== undefined);
        const sessionId = this.#sessions.get(id);
        if (!sessionId) throw new Error("ACP 会话绑定缺失");
        if (initialConfig !== undefined) {
          if (await this.history.hasTurns(id))
            throw new AgentTurnNotSubmittedError("任务已有历史，请使用现有会话继续聊天");
          // 配置和 prompt 共用任务串行锁；配置失败仍属于明确未发送，可沿用原提交身份重试。
          await applyAcpConfig(
            agent,
            sessionId,
            agent.readSessionState(sessionId).configOptions,
            initialConfig,
          );
          this.#needsDefaults.delete(id);
        }
        const selected = migrateAcpSettings(
          {
            ...(options.model ? { model: options.model } : {}),
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          },
          agent.readSessionState(sessionId).configOptions,
        );
        if (selected.unmapped.length) throw new Error("ACP agent 未提供选定的模型或思考配置");
        for (const [configId, value] of Object.entries(selected.values)) {
          await agent.setConfigOption(sessionId, configId, value);
        }
        await this.#patch(id, {
          status: "active",
          updatedAt: Math.floor(Date.now() / 1000),
        });
        signal?.throwIfAborted();
        if (!this.#ephemeral.has(id)) await this.prepareTaskTitle?.(task, input);
        const projection = new AcpEventProjection(id, randomUUID(), this.#emit);
        this.#active.set(id, projection);
        projection.userMessage(`acp:message:user:${randomUUID()}`, input.text, attachments);
        const turn = projection.snapshot();
        this.#emit({ type: "turn.started", taskId: id, turnId: turn.id, payload: { turn } });
        if (signal?.aborted) {
          this.#active.delete(id);
          signal.throwIfAborted();
        }
        // ACP prompt 的响应直到回合结束才返回；提交立即返回，持续输出走已有事件通道。
        submitted();
        const settlement = agent
          .prompt({
            sessionId,
            prompt,
          })
          .then(
            (result) => projection.finish(result.stopReason),
            (error: unknown) =>
              projection.fail(error instanceof Error ? error.message : "ACP 连接失败"),
          )
          .then(async (final) => {
            if (!this.#ephemeral.has(id)) await this.history.append(id, final);
            await this.#patch(id, {
              status: "idle",
              updatedAt: Math.floor(Date.now() / 1000),
            });
            if (!this.#ephemeral.has(id)) this.#active.delete(id);
          })
          .catch((error: unknown) => {
            this.#emit({
              type: "task.notice",
              taskId: id,
              payload: {
                code: "runtime_warning",
                level: "warning",
                message: error instanceof Error ? error.message : "ACP 历史保存失败",
              },
            });
          });
        this.#settlements.add(settlement);
        this.#taskSettlements.set(id, settlement);
        void settlement.finally(() => {
          this.#settlements.delete(settlement);
          this.#taskSettlements.delete(id);
        });
        return turn;
      }),
    );
  }
  generateText(text: string, model: string | undefined, signal: AbortSignal): Promise<string> {
    return generateAcpText(
      {
        create: () => this.startTask({ ephemeral: true }),
        subscribe: (listener) => this.subscribeEvents(listener, { includeEphemeral: true }),
        start: (id, prompt, selected, abort) =>
          this.#startTurn(
            id,
            { text: prompt, files: [], images: [], skills: [], textAttachments: [] },
            selected ? { model: selected } : {},
            abort,
          ),
        interrupt: (id, turn) => this.interruptTurn(id, turn),
        release: async (id) => {
          await this.#taskSettlements.get(id);
          if (!this.#closed) await this.unsubscribeTask(id);
        },
      },
      text,
      model,
      signal,
    );
  }
  renameTask(id: string, title: string) {
    return this.#serial(id, () => this.#management.renameTask(id, title));
  }
  pinTask(id: string, pinned: boolean) {
    return this.#serial(id, () => this.#management.pinTask(id, pinned));
  }
  archiveTask(id: string) {
    return this.#serial(id, () => this.#management.archiveTask(id));
  }
  unarchiveTask(id: string) {
    return this.#serial(id, () => this.#management.unarchiveTask(id));
  }
  deleteTask(id: string) {
    return this.#serial(id, () => this.#management.deleteTask(id));
  }
  async readSessionState(id: string): Promise<AcpSessionMetadata> {
    return this.#serial(id, async () => {
      const agent = await this.#load(await this.#task(id));
      const session = this.#sessions.get(id);
      if (!session) throw new Error("ACP 会话绑定缺失");
      return agent.readSessionState(session);
    });
  }
  readSessionConfiguration(id: string): Promise<SessionConfigOption[]> {
    return this.readSessionState(id).then((state) => state.configOptions);
  }
  async setSessionConfiguration(
    id: string,
    configId: string,
    value: string | boolean,
  ): Promise<SessionConfigOption[]> {
    return this.#serial(id, async () => {
      const agent = await this.#load(await this.#task(id));
      const options = await applyAcpConfig(
        agent,
        this.#sessions.get(id) ?? "",
        agent.readSessionState(this.#sessions.get(id) ?? "").configOptions,
        { [configId]: value },
      );
      return structuredClone(options);
    });
  }
  getCapabilities() {
    return acpCapabilities(this.engine);
  }
  listModels() {
    return discoverAcpModels(this);
  }
  async unsubscribeTask(id: string) {
    return this.#serial(id, async () => {
      if (!this.#ephemeral.has(id) && !this.#sessions.has(id)) return "notLoaded" as const;
      if (this.#active.get(id)?.snapshot().status === "running") return "busy" as const;
      await this.#taskSettlements.get(id);
      const session = this.#sessions.get(id);
      if (session) await (await this.#agent()).closeSession(session);
      this.#sessions.delete(id);
      this.#needsDefaults.delete(id);
      this.#active.delete(id);
      this.#ephemeral.delete(id);
      return "unsubscribed" as const;
    });
  }
  async interruptTurn(id: string, turnId: string): Promise<void> {
    await this.#task(id);
    const active = this.#active.get(id);
    if (!active || active.turnId !== turnId) return;
    const session = this.#sessions.get(id);
    if (session) await (await this.#agent()).cancel(session);
  }
  async startConfiguredTurn(
    id: string,
    input: AgentProviderTurnInput,
    initialConfig?: AcpConfigValues,
  ): Promise<AgentTurn> {
    await this.#taskSettlements.get(id);
    return this.#startTurn(id, input, {}, undefined, initialConfig);
  }
  async readTaskAttachment(id: string, attachmentId: string) {
    await this.#task(id);
    return this.attachments.read(id, attachmentId);
  }
  async resolvePendingRequest(input: ResolvePendingRequestInput) {
    await this.#task(input.taskId);
    return this.#permissions.resolve(input);
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#permissions.close();
    const connection = await this.#connection?.catch(() => undefined);
    connection?.close();
    await Promise.all(this.#settlements);
    this.#listeners.clear();
  }
}
