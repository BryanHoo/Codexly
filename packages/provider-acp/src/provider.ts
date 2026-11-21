import type { AcpBackgroundTarget, AcpConfigOption } from "@codexly/protocol";
import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable";
import { AcpTaskManagement } from "./task-management.js";
import { readAcpTaskSnapshot, readAcpTaskSessionState } from "./task-snapshot.js";
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
import type { AcpConnection, AcpClientCallbacks } from "./connection.js";
import type { AcpHistory } from "./history.js";
import type { AcpReplay } from "./replay.js";
import { routeAcpUpdate, taskForAcpSession } from "./provider-session-events.js";
import { loadAcpSession } from "./session-loading.js";
import type { AcpSessionInitialization } from "./session-initialization.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { AcpEventProjection } from "./event-projection.js";
import { AcpPermissions } from "./permissions.js";
import { createAcpPrompt } from "./turn-input.js";
import { acpCapabilities, discoverAcpModels } from "./provider-discovery.js";
import { migrateAcpSettings } from "./migration.js";
import { applyAcpConfig } from "./configuration.js";
import { sendAcpPrompt, submitAcpTurn } from "./turn-submission.js";
import { startAcpLocalTask } from "./task-creation.js";
import { generateAcpText } from "./text-generation.js";
import type { AcpSessionMetadata } from "./session-metadata.js";
import { persistAcpTurn } from "./turn-persistence.js";
import { AcpHistoryUse } from "./history-use.js";
import { AcpProviderConnection } from "./provider-connection.js";
/** 同一实现接入任意 ACP agent；应用任务管理与 agent 的原生会话身份保持分离。 */
export class AcpAgentProvider implements AgentExecutionAdapter {
  readonly #listeners = new Map<AgentProviderEventListener, boolean>();
  readonly #ephemeral = new Map<string, LocalTask>();
  readonly #taskSettlements = new Map<string, Promise<void>>();
  readonly #failedCommits = new Map<string, () => Promise<void>>();
  readonly #link: AcpProviderConnection;
  readonly #needsDefaults = new Set<string>();
  readonly #replays = new Map<string, AcpReplay>();
  readonly #active = new Map<string, AcpEventProjection>();
  readonly #settlements = new Set<Promise<void>>();
  readonly #operations = new Map<string, Promise<unknown>>();
  readonly #historyUse: AcpHistoryUse;
  #closed = false;
  readonly #permissions: AcpPermissions;
  readonly attachments: HistoricalTaskAttachments;
  readonly #management: AcpTaskManagement;
  prepareTaskTitle?: (task: LocalTask, input: AgentProviderTurnInput) => Promise<void>;
  publishTaskTitle(id: string, title: string): void {
    this.#emit({ type: "task.metadata_changed", taskId: id, payload: { title } });
  }
  /** 运行中及终态待落盘回合仍归原连接所有，搜索不能另开重放覆盖它。 */
  hasPendingTurn(id: string): boolean {
    return this.#active.has(id);
  }
  constructor(
    readonly engine: AgentEngine,
    readonly scope: AgentTaskScope,
    readonly store: LocalCatalogStore,
    readonly history: AcpHistory,
    connect: (callbacks: AcpClientCallbacks) => Promise<AcpConnection>,
    readonly initializeSession?: (
      connection: AcpConnection,
      sessionId: string,
      options: AcpConfigOption[],
      saved?: AcpStoredSettings,
    ) => Promise<AcpConfigOption[]>,
    readonly initialization?: AcpSessionInitialization,
  ) {
    this.#historyUse = new AcpHistoryUse(history);
    this.attachments = new HistoricalTaskAttachments(join(history.directory, "task-attachments"));
    this.#permissions = new AcpPermissions(scope.id, this.#emit);
    this.#link = new AcpProviderConnection(
      connect,
      {
        onSessionState: this.#emitSessionState,
        onUpdate: (notification, historical) =>
          routeAcpUpdate(
            notification,
            historical,
            this.#link.sessions,
            this.#replays,
            this.#active,
          ),
        requestPermission: (request, signal) => {
          const task = taskForAcpSession(this.#link.sessions, request.sessionId);
          const active = task ? this.#active.get(task) : undefined;
          return task && active?.running && !this.#ephemeral.has(task)
            ? this.#permissions.request(task, active.turnId, request, signal)
            : Promise.resolve({ outcome: { outcome: "cancelled" } });
        },
      },
      () => this.#operations.size === 0 && this.#active.size === 0,
      () => {
        this.#needsDefaults.clear();
      },
    );
    this.#management = new AcpTaskManagement(
      engine,
      scope.kind === "temporary" ? null : scope.id,
      store,
      (id) => this.#active.has(id),
      async (task) => {
        if (task.sessionId) await (await this.#link.get()).deleteSession(task.sessionId);
        this.#link.sessions.delete(task.id);
        this.#link.detached.delete(task.id);
        this.#needsDefaults.delete(task.id);
      },
      async (id) => {
        await this.initialization?.deleteTask(id);
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
        if (this.#operations.get(id) === operation) {
          this.#operations.delete(id);
          this.#link.recycleIdle();
        }
      })
      .catch(() => undefined);
    return operation;
  }
  readonly #emitSessionState = (sessionId: string, state: AcpSessionMetadata): void => {
    const task = taskForAcpSession(this.#link.sessions, sessionId);
    if (task && !this.#link.detached.has(task))
      this.#emit({ type: "acp.session.updated", taskId: task, payload: { state } });
    else if (task && state.background?.length === 0) this.#link.recycleIdle();
  };
  async #load(task: LocalTask, explicitConfig = false, repairHistory = false) {
    const connection = await loadAcpSession(task, explicitConfig, {
      sessions: this.#link.sessions,
      needsDefaults: this.#needsDefaults,
      replays: this.#replays,
      ephemeral: this.#ephemeral.has(task.id),
      repairHistory,
      history: this.history,
      ...(this.initialization ? { initialization: this.initialization } : {}),
      ...(this.initializeSession ? { initialize: this.initializeSession } : {}),
      agent: () =>
        this.#historyUse.connect(task.id, () => this.#link.get(), this.#ephemeral.has(task.id)),
      patch: (patch) => this.#patch(task.id, patch),
      store: this.store,
      updated: (connection, session) => {
        this.#emitSessionState(session, connection.readSessionState(session));
      },
    });
    this.#link.detached.delete(task.id);
    return connection;
  }
  async startTask(options: StartAgentTaskOptions = {}) {
    if (this.#closed) throw new Error("ACP Provider 已关闭");
    return startAcpLocalTask(this.engine, this.scope, options, this.store, this.#ephemeral);
  }
  readTask(id: string, input: ReadAgentTaskInput = {}): Promise<AgentProviderTaskSnapshot> {
    return this.#serial(id, async () => {
      input.signal?.throwIfAborted();
      const task = await this.#task(id);
      await this.#historyUse.retain(id, this.#ephemeral.has(id));
      return readAcpTaskSnapshot(task, input, {
        engine: this.engine,
        history: this.history,
        load: (repairHistory) => this.#load(task, false, repairHistory),
        active: () => this.#active.get(id),
        needsReplay: async () =>
          !this.#link.sessions.has(id) && (await this.history.needsReplay(id)),
        pending: () => this.#permissions.list(id),
        contextUsage: () =>
          this.#link.instance?.readSessionUsage(this.#link.sessions.get(id)) ?? null,
        sessionState: () => readAcpTaskSessionState(this.#link.instance, this.#link.sessions, id),
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
    return submitAcpTurn((submitted, onRollback) =>
      this.#serial(id, async () => {
        // 上次回答若因真正的存储故障滞留，用户继续发送时只先补写历史。
        const recover = this.#failedCommits.get(id);
        if (recover) await recover();
        if (this.#active.has(id))
          throw new AgentTurnNotSubmittedError("任务已有运行中或待持久化回合");
        const task = await this.#task(id);
        const agent = await this.#link.get();
        const bound = this.#link.sessions.get(id);
        if (bound) agent.assertSessionReady(bound);
        const prompt = await createAcpPrompt(
          input,
          agent.initialization.capabilities?.session?.prompt ?? {},
          join(
            this.history.directory,
            "attachments",
            createHash("sha256").update(id).digest("hex"),
          ),
          onRollback,
        );
        const attachments = await this.attachments.prepare(id, input);
        await this.#load(task, initialConfig !== undefined);
        const sessionId = this.#link.sessions.get(id);
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
          if (!this.#ephemeral.has(id))
            await this.initialization?.complete({ ...task, sessionId }, sessionId);
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
        if (this.engine === "codex" && !this.#ephemeral.has(id))
          await this.initialization?.markFirstPrompt({ ...task, sessionId }, sessionId);
        const projection = new AcpEventProjection(id, randomUUID(), this.#emit, true);
        this.#active.set(id, projection);
        projection.userMessage(`acp:message:user:${randomUUID()}`, input.text, attachments);
        const turn = projection.snapshot();
        this.#emit({ type: "turn.started", taskId: id, turnId: turn.id, payload: { turn } });
        if (signal?.aborted) {
          this.#active.delete(id);
          signal.throwIfAborted();
        }
        submitted();
        const settlement = sendAcpPrompt(agent, sessionId, prompt, projection, input.submissionKey)
          .then(
            (result) => projection.finish(result.stopReason),
            (error: unknown) =>
              projection.fail(error instanceof Error ? error.message : "ACP 连接失败"),
          )
          .then((final) => this.#commitTurn(id, projection, final, prompt));
        this.#settlements.add(settlement);
        this.#taskSettlements.set(id, settlement);
        void settlement.finally(() => {
          this.#settlements.delete(settlement);
          this.#taskSettlements.delete(id);
          this.#link.recycleIdle();
        });
        return turn;
      }),
    );
  }
  async #commitTurn(
    id: string,
    projection: AcpEventProjection,
    final: AgentTurn,
    prompt: acp.ContentBlock[],
  ): Promise<void> {
    this.#permissions.finishTurn(id, final.id);
    if (this.#ephemeral.has(id)) {
      projection.publishCompletion(final);
      return;
    }
    const persist = persistAcpTurn(this.history, projection, final, prompt, () =>
      this.#patch(id, { status: "idle", updatedAt: Math.floor(Date.now() / 1000) }),
    );
    const commit = async () => {
      const stored = await persist();
      // 终态会同步唤醒队列；同一事件循环内先释放占用，再公布持久化后的正文。
      this.#failedCommits.delete(id);
      this.#active.delete(id);
      projection.publishCompletion(stored);
    };
    try {
      await commit();
    } catch (error) {
      this.#failedCommits.set(id, commit);
      projection.storageFailed(error instanceof Error ? error.message : "暂不能保存对话。");
    }
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
  async cancelBackground(id: string, target: AcpBackgroundTarget): Promise<void> {
    await this.#task(id);
    const session = this.#link.sessions.get(id);
    const connection = this.#link.instance;
    if (!connection || !session) throw new Error("ACP 会话已断开");
    await connection.cancelBackground(session, target);
  }
  async readSessionState(id: string): Promise<AcpSessionMetadata> {
    return this.#serial(id, async () => {
      const agent = await this.#load(await this.#task(id));
      const session = this.#link.sessions.get(id);
      if (!session) throw new Error("ACP 会话绑定缺失");
      return agent.readSessionState(session);
    });
  }
  readSessionConfiguration(id: string): Promise<AcpConfigOption[]> {
    return this.readSessionState(id).then((state) => state.configOptions);
  }
  async setSessionConfiguration(
    id: string,
    configId: string,
    value: string | boolean,
  ): Promise<AcpConfigOption[]> {
    return this.#serial(id, async () => {
      const agent = await this.#load(await this.#task(id));
      const session = this.#link.sessions.get(id);
      if (!session) throw new Error("ACP 会话绑定缺失");
      const current = agent.readSessionState(session).configOptions;
      return applyAcpConfig(agent, session, current, { [configId]: value });
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
      if (
        !this.#ephemeral.has(id) &&
        (!this.#link.sessions.has(id) || this.#link.detached.has(id))
      ) {
        await this.#historyUse.release(id);
        return "notLoaded" as const;
      }
      if (this.#active.get(id)?.running || this.#failedCommits.has(id)) return "busy" as const;
      await this.#taskSettlements.get(id);
      if (await this.#link.releaseSession(id, this.#ephemeral.has(id)))
        this.#needsDefaults.delete(id);
      this.#active.delete(id);
      this.#ephemeral.delete(id);
      await this.#historyUse.release(id);
      return "unsubscribed" as const;
    });
  }
  interruptTurn(id: string, turnId: string): Promise<void> {
    // 中断与新输入串行，防止旧取消通知落到后来回合。
    return this.#serial(id, async () => {
      await this.#task(id);
      const session = this.#link.sessions.get(id);
      const active = this.#active.get(id);
      if (!session || !active?.running || active.turnId !== turnId) return;
      const agent = await this.#link.get();
      const current = this.#active.get(id);
      if (!current?.running || current.turnId !== turnId) return;
      await agent.cancel(session);
    });
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
    return this.#historyUse.readAttachment(this.attachments, id, attachmentId);
  }
  async resolvePendingRequest(input: ResolvePendingRequestInput) {
    await this.#task(input.taskId);
    return this.#permissions.resolve(input);
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#permissions.close();
    try {
      await this.#link.close();
      await Promise.allSettled(this.#operations.values());
      await Promise.all(this.#settlements);
    } finally {
      this.#listeners.clear();
      await this.#historyUse.close();
    }
  }
}
