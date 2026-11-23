import { join } from "node:path";
import type { AcpBackgroundTarget, AcpConfigOption } from "@codexly/protocol";
import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { randomUUID } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpTaskManagement } from "./task-management.js";
import * as taskSnapshot from "./task-snapshot.js";
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
import { acpSessionCallbacks, publishAcpSessionState } from "./provider-session-events.js";
import { loadAcpSession } from "./session-loading.js";
import type { AcpSessionInitialization } from "./session-initialization.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { AcpEventProjection } from "./event-projection.js";
import { AcpPermissions } from "./permissions.js";
import { AcpElicitations } from "./elicitation.js";
import { acpCapabilities, discoverAcpModels } from "./provider-discovery.js";
import { applyAcpConfig, configureAcpTurn } from "./configuration.js";
import { prepareAcpPrompt, sendAcpPrompt, submitAcpTurn } from "./turn-submission.js";
import { steerAcpTurn } from "./steering.js";
import { startAcpLocalTask } from "./task-creation.js";
import { generateAcpText } from "./text-generation.js";
import type { AcpSessionMetadata } from "./session-metadata.js";
import { persistAcpTurn } from "./turn-persistence.js";
import { AcpHistoryUse } from "./history-use.js";
import { AcpSubagentBackground } from "./subagent-background.js";
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
  readonly #background: AcpSubagentBackground;
  readonly #historyUse: AcpHistoryUse;
  #closed = false;
  readonly #permissions: AcpPermissions;
  readonly #elicitations: AcpElicitations;
  readonly attachments: HistoricalTaskAttachments;
  readonly #management: AcpTaskManagement;
  readExternalHistory?: taskSnapshot.AcpExternalHistoryReader;
  prepareTaskTitle?: (task: LocalTask, input: AgentProviderTurnInput) => Promise<void>;
  publishTaskTitle(id: string, title: string): void {
    this.#emit({ type: "task.metadata_changed", taskId: id, payload: { title } });
  }
  hasPendingTurn = (id: string): boolean => this.#active.has(id);
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
    this.#background = new AcpSubagentBackground(history, this.#emit, (id) =>
      this.#taskSettlements.get(id),
    );
    this.attachments = new HistoricalTaskAttachments(join(history.directory, "task-attachments"));
    this.#permissions = new AcpPermissions(scope.id, this.#emit);
    this.#elicitations = new AcpElicitations(scope.id, this.#emit);
    this.#link = new AcpProviderConnection(
      connect,
      acpSessionCallbacks({
        link: () => this.#link,
        engine,
        emit: this.#emit,
        active: this.#active,
        background: this.#background,
        ephemeral: this.#ephemeral,
        replays: this.#replays,
        permissions: this.#permissions,
        elicitations: this.#elicitations,
        syncTitle: this.#syncTitle,
      }),
      () => this.#operations.size === 0 && this.#active.size === 0,
      () => {
        this.#needsDefaults.clear();
        this.#elicitations.clear();
        void this.#background.close().catch(() => undefined);
      },
    );
    this.#management = new AcpTaskManagement(
      engine,
      scope.kind === "temporary" ? null : scope.id,
      store,
      (id) => this.#active.has(id),
      async (task) => {
        await this.#link.deleteSession(task.id, task.sessionId);
        await this.#background.flush(task.id);
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
    return this.#ephemeral.get(id) ?? this.#management.readTask(id);
  }
  readonly #syncTitle = (id: string, sessionId: string) => {
    if (this.#ephemeral.has(id)) return;
    this.#management.syncAgentTitle(id, sessionId, this.#link, (work) => this.#serial(id, work));
  };
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
        const state = connection.readSessionState(session);
        publishAcpSessionState(this.#link, session, state, this.#emit);
        if (state.title !== undefined) this.#syncTitle(task.id, session);
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
      return taskSnapshot.readAcpTaskSnapshot(task, input, {
        engine: this.engine,
        history: this.history,
        load: (repairHistory) => this.#load(task, false, repairHistory),
        active: () => this.#active.get(id),
        background: this.#background,
        needsReplay: async () =>
          !this.#link.sessions.has(id) && (await this.history.needsReplay(id)),
        ...(this.readExternalHistory ? { readExternalHistory: this.readExternalHistory } : {}),
        pending: () => [...this.#permissions.list(id), ...this.#elicitations.list(id)],
        contextUsage: () =>
          this.#link.instance?.readSessionUsage(this.#link.sessions.get(id)) ?? null,
        sessionState: () =>
          taskSnapshot.readAcpTaskSessionState(this.#link.instance, this.#link.sessions, id),
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
        const prompt = await prepareAcpPrompt(agent, this.history.directory, id, input, onRollback);
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
        await configureAcpTurn(
          agent,
          sessionId,
          options,
          task,
          this.#ephemeral.has(id) ? undefined : this.initialization,
        );
        await this.#patch(id, {
          status: "active",
          updatedAt: Math.floor(Date.now() / 1000),
        });
        signal?.throwIfAborted();
        if (!this.#ephemeral.has(id)) await this.prepareTaskTitle?.(task, input);
        if (this.engine === "codex" && !this.#ephemeral.has(id))
          await this.initialization?.markFirstPrompt({ ...task, sessionId }, sessionId);
        await this.#background.flush(id);
        const projection = new AcpEventProjection(
          id,
          randomUUID(),
          this.#emit,
          true,
          this.#ephemeral.has(id) ? undefined : () => this.history.cache.content(id),
        );
        this.#active.set(id, projection);
        projection.userMessage(`acp:message:user:${randomUUID()}`, input.text, attachments);
        const turn = projection.snapshot();
        this.#emit({ type: "turn.started", taskId: id, turnId: turn.id, payload: { turn } });
        if (signal?.aborted) {
          this.#active.delete(id);
          signal.throwIfAborted();
        }
        submitted();
        const settlement = sendAcpPrompt(
          agent,
          sessionId,
          prompt,
          projection,
          input.submissionKey,
        ).then((final) => this.#commitTurn(id, projection, final, prompt));
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
  steerTurn(id: string, turnId: string, input: AgentProviderTurnInput): Promise<void> {
    return this.#serial(id, () =>
      steerAcpTurn(
        this.#link.instance,
        this.#link.sessions.get(id),
        this.#active.get(id),
        turnId,
        input,
        this.history.directory,
        this.attachments,
      ),
    );
  }
  async #commitTurn(
    id: string,
    projection: AcpEventProjection,
    final: AgentTurn,
    prompt: acp.ContentBlock[],
  ): Promise<void> {
    this.#permissions.finishTurn(id, final.id);
    this.#elicitations.finishTurn(id, final.id);
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
  cancelBackground(id: string, target: AcpBackgroundTarget): Promise<void> {
    return this.#task(id).then(() => this.#link.cancelBackground(id, target));
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
      const task = await this.#task(id);
      const agent = await this.#load(task);
      const session = this.#link.sessions.get(id);
      if (!session) throw new Error("ACP 会话绑定缺失");
      const current = agent.readSessionState(session).configOptions;
      const options = await applyAcpConfig(agent, session, current, { [configId]: value });
      if (!this.#ephemeral.has(id))
        await this.initialization?.saveConfiguration(task, session, options);
      return options;
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
      await this.#background.flush(id);
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
      const agent = this.#link.instance;
      if (!session || !agent || !active?.running || active.turnId !== turnId) return;
      // 先向 Agent 发出回合取消，再释放等待中的用户交互，避免 Agent 抢先继续执行。
      await agent.cancel(session);
      this.#permissions.cancelTurn(id, turnId);
      this.#elicitations.finishTurn(id, turnId);
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
    return input.type === "mcp_elicitation"
      ? this.#elicitations.resolve(input)
      : this.#permissions.resolve(input);
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#permissions.close();
    this.#elicitations.clear();
    try {
      await this.#link.close();
      await Promise.allSettled(this.#operations.values());
      await Promise.all(this.#settlements);
      await this.#background.close();
    } finally {
      this.#listeners.clear();
      await this.#historyUse.close();
    }
  }
}
