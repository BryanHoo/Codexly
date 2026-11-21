import { projectAcpConfig } from "./session-options.js";
import type { AcpBackgroundTarget, AcpConfigOption } from "@codexly/protocol";
import * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable";
import { AcpAuthStatusTracker } from "./auth-status.js";
import { AcpSessionMetadataStore, type AcpSessionMetadata } from "./session-metadata.js";

const CANCEL_GRACE_MS = 5_000;
const SESSION_CAPACITY = 64;

interface ActivePrompt {
  terminal: PromiseWithResolvers<acp.IdleStateUpdate | null>;
  abandoned: PromiseWithResolvers<never>;
  observedForeground: boolean;
  echoedMessageId?: string;
  acceptedMessageId?: string;
  idleAfterEcho?: acp.IdleStateUpdate;
}

interface PendingCancellation {
  sent: boolean;
  timedOut: boolean;
  write: Promise<void>;
  finish(): void;
}

export interface AcpClientCallbacks {
  /** 更新直接增量交付；上层按 sessionId 路由，禁止在这里重建整个历史。 */
  onUpdate?(notification: acp.UpdateSessionNotification, historical: boolean): void | Promise<void>;
  onSessionState?(sessionId: string, state: AcpSessionMetadata): void | Promise<void>;
  requestPermission?(
    request: acp.RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse>;
}

/** 仅对接 ACP 稳定接口，不解释 Codex 或 Claude 的私有协议。 */
export class AcpConnection {
  readonly #activePrompts = new Map<string, ActivePrompt>();
  readonly #cancellations = new Map<string, PendingCancellation>();
  readonly #sessions = new Set<string>();
  #pendingBindings = 0;

  private constructor(
    readonly initialization: acp.InitializeResponse,
    readonly transport: acp.ClientConnection,
    readonly drainUpdates: () => Promise<void>,
    private readonly authStatus: AcpAuthStatusTracker,
    private readonly replaying: Map<string, boolean>,
    private readonly metadata: AcpSessionMetadataStore,
    private readonly publishReceipt: (
      sessionId: string,
      turnId: string,
      messageId: string,
    ) => Promise<void>,
    private readonly updateConfiguration: (
      sessionId: string,
      options: AcpConfigOption[],
      commands?: acp.AvailableCommand[],
    ) => Promise<void>,
  ) {
    const release = () => {
      for (const active of this.#activePrompts.values()) active.terminal.resolve(null);
      for (const cancellation of this.#cancellations.values()) cancellation.finish();
    };
    void transport.closed.then(release, release);
  }

  static async connect(
    stream: acp.Stream,
    callbacks: AcpClientCallbacks = {},
    options: { handshakeTimeoutMs?: number } = {},
  ): Promise<AcpConnection> {
    let updates = Promise.resolve();
    let connection: AcpConnection | undefined;
    const replaying = new Map<string, boolean>();
    const metadata = new AcpSessionMetadataStore();
    const authStatus = new AcpAuthStatusTracker();
    const enqueue = (operation: () => void | Promise<void>) => {
      updates = updates.then(operation);
      void updates.catch((error: unknown) => {
        transport.close(error);
      });
      return updates;
    };
    const reader = stream.readable.getReader();
    // 文件投影形成背压；不让 SDK 持续读入整份历史而堆积异步回调。
    const incoming = new ReadableStream<acp.AnyMessage>(
      {
        async pull(controller) {
          await updates;
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        async cancel(reason) {
          await reader.cancel(reason);
        },
      },
      { highWaterMark: 0 },
    );
    const transport = acp
      .client({ name: "codexly" })
      .onNotification(
        "_auth/status_update",
        (value: unknown) => value,
        ({ params }) => {
          authStatus.update(params);
        },
      )
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        return enqueue(async () => {
          const { sessionId, update } = params;
          const historical = replaying.get(sessionId) === false;
          // 标记后的通知属于实时流，即使 resume 的 RPC 响应还没有返回。
          if (update.sessionUpdate === "replay_complete") {
            if (historical) replaying.set(sessionId, true);
            return;
          }
          // 回放可补充历史上下文用量，其余历史快照不覆盖当前活动状态。
          if (!historical || acp.SessionUpdate.isUsageUpdate(update)) {
            const state = metadata.update(params);
            if (state) await callbacks.onSessionState?.(sessionId, state);
          }
          await callbacks.onUpdate?.(params, historical);
          if (!historical) connection?.observePrompt(sessionId, update);
        });
      })
      .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => {
        // 不提供隐式批准；UI 必须保留 agent 原始 optionId 和权限含义。
        return (
          callbacks.requestPermission?.(params, signal) ?? {
            outcome: { outcome: "cancelled" as const },
          }
        );
      })
      .connect({ readable: incoming, writable: stream.writable });
    const timeout = setTimeout(() => {
      transport.close(new Error("ACP 握手超时"));
    }, options.handshakeTimeoutMs ?? 30_000);
    timeout.unref();
    try {
      const initialization = await transport.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        info: { name: "codexly", version: "0.53.0" },
        // 文件与终端由 agent 自行执行，只有实现了对应客户端方法才能声明能力。
        capabilities: {},
      });
      if (initialization.protocolVersion !== acp.PROTOCOL_VERSION)
        throw new Error(`不支持 ACP 协议版本 ${String(initialization.protocolVersion)}`);
      const cleanUp = async () => {
        authStatus.close();
        try {
          for (const [id, state] of metadata.disconnected()) {
            await callbacks.onSessionState?.(id, state);
          }
        } finally {
          metadata.clear();
        }
      };
      void transport.closed.then(cleanUp, cleanUp).catch(() => undefined);
      connection = new AcpConnection(
        initialization,
        transport,
        () => updates,
        authStatus,
        replaying,
        metadata,
        (sessionId, turnId, messageId) =>
          enqueue(async () => {
            const state = metadata.confirmPrompt(sessionId, turnId, messageId);
            if (state) await callbacks.onSessionState?.(sessionId, state);
          }),
        (id, options, commands) =>
          enqueue(async () => {
            const state = metadata.configure(id, options, commands);
            if (state) await callbacks.onSessionState?.(id, state);
          }),
      );
      return connection;
    } catch (error) {
      transport.close(error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  get closed(): Promise<void> {
    return this.transport.closed;
  }
  get atSessionCapacity(): boolean {
    return this.#sessions.size + this.#pendingBindings >= SESSION_CAPACITY;
  }
  get canRestoreSessions(): boolean {
    return Boolean(this.initialization.capabilities?.session);
  }

  assertSessionReady(sessionId: string): void {
    if (this.isAwaitingCancellation(sessionId))
      throw new Error("ACP 会话的取消尚未确认，请稍后重试");
  }

  isAwaitingCancellation(sessionId: string): boolean {
    return this.#cancellations.get(sessionId)?.timedOut === true;
  }

  recycleAbandoned(): boolean {
    if (
      this.#pendingBindings ||
      ![...this.#cancellations.values()].some(({ timedOut }) => timedOut) ||
      [...this.#activePrompts.keys()].some((id) => !this.#cancellations.get(id)?.timedOut) ||
      (!this.canRestoreSessions && !this.#allSessionsAbandoned())
    )
      return false;
    this.close();
    return true;
  }

  #allSessionsAbandoned(): boolean {
    return [...this.#sessions].every((id) => this.#cancellations.get(id)?.timedOut);
  }
  readAuthStatus() {
    const marker = this.initialization.capabilities?._meta?.["authStatus"];
    return this.authStatus.read(marker !== undefined && marker !== null);
  }
  readSessionState(sessionId: string): AcpSessionMetadata {
    return this.metadata.read(sessionId);
  }
  readSessionUsage(sessionId: string | undefined) {
    return sessionId ? this.metadata.readUsage(sessionId) : null;
  }
  cacheSessionConfiguration(sessionId: string, options: AcpConfigOption[]): Promise<void> {
    // 默认值初始化只能提交已经由 ACP 响应确认的完整选项，不建立另一份配置缓存。
    return this.updateConfiguration(sessionId, options);
  }
  forgetSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
    this.metadata.delete(sessionId);
  }

  async newSession(
    request: acp.NewSessionRequest,
  ): Promise<Omit<acp.NewSessionResponse, "configOptions"> & { configOptions: AcpConfigOption[] }> {
    this.#beginBinding();
    try {
      const result = await this.transport.agent.request(acp.methods.agent.session.new, request);
      const configOptions = projectAcpConfig(result.configOptions ?? []);
      await this.updateConfiguration(
        result.sessionId,
        configOptions,
        result.availableCommands ?? [],
      );
      this.#sessions.add(result.sessionId);
      await this.drainUpdates();
      return { ...result, configOptions };
    } finally {
      this.#finishBinding();
    }
  }

  async resumeSession(
    request: acp.ResumeSessionRequest,
  ): Promise<
    Omit<acp.ResumeSessionResponse, "configOptions"> & { configOptions: AcpConfigOption[] }
  > {
    const { sessionId, replayFrom } = request;
    if (!this.canRestoreSessions) throw new Error("ACP Agent 未声明会话能力");
    this.assertSessionReady(sessionId);
    if (this.#activePrompts.has(sessionId)) throw new Error("会话正在进行中");
    // 必须保持原生会话身份；错误直接返回，禁止回退 newSession 丢失上下文。
    this.#beginBinding(sessionId);
    if (replayFrom) this.replaying.set(sessionId, false);
    try {
      const result = await this.transport.agent.request(acp.methods.agent.session.resume, request);
      await this.drainUpdates();
      // v2 用显式边界区分历史回放与实时事件，缺少边界时保留原历史。
      if (replayFrom && !this.replaying.get(sessionId))
        throw new Error("ACP 历史回放未收到 replay_complete");
      const configOptions = projectAcpConfig(result.configOptions ?? []);
      await this.updateConfiguration(sessionId, configOptions, result.availableCommands ?? []);
      this.#sessions.add(sessionId);
      return { ...result, configOptions };
    } finally {
      this.replaying.delete(sessionId);
      this.#finishBinding();
    }
  }
  #beginBinding(sessionId?: string): void {
    // 绑定中的并发请求也占用额度，退订但无法 close 的会话仍计入真实连接容量。
    if ((sessionId === undefined || !this.#sessions.has(sessionId)) && this.atSessionCapacity)
      throw new Error("ACP 活跃会话达到容量限制");
    this.#pendingBindings++;
  }
  #finishBinding(): void {
    // 并发会话绑定全部结束后才清理未绑定缓存，不能删除另一请求提前公布的命令。
    if (--this.#pendingBindings === 0) this.metadata.retain(this.#sessions);
  }

  private observePrompt(sessionId: string, update: acp.SessionUpdate): void {
    const active = this.#activePrompts.get(sessionId);
    if (!active) return;
    // Agent 可能重复报告上一回合的 idle。先观察收到新消息或前台状态，再接受终态。
    if (acp.SessionUpdate.isUserMessage(update) || acp.SessionUpdate.isUserMessageChunk(update)) {
      if (active.echoedMessageId !== update.messageId) delete active.idleAfterEcho;
      active.echoedMessageId = update.messageId;
      return;
    }
    if (update.sessionUpdate !== "state_update" || !acp.SessionUpdate.isStateUpdate(update)) return;
    if (update.state === "running" || update.state === "requires_action")
      active.observedForeground = true;
    else if (acp.StateUpdate.isIdle(update)) {
      if (active.observedForeground) active.terminal.resolve(update);
      else if (active.echoedMessageId) {
        active.idleAfterEcho ??= update;
        if (active.echoedMessageId === active.acceptedMessageId)
          active.terminal.resolve(active.idleAfterEcho);
      }
    }
  }

  async prompt(
    request: acp.PromptRequest,
    receipt?: { turnId: string; accept(messageId: string): void },
  ): Promise<{ stopReason: string }> {
    const id = request.sessionId;
    this.assertSessionReady(id);
    if (!this.#sessions.has(id)) throw new Error("ACP 会话尚未加载");
    if (this.#activePrompts.has(id)) throw new Error("会话已有输入进行中");
    const active: ActivePrompt = {
      terminal: Promise.withResolvers<acp.IdleStateUpdate | null>(),
      abandoned: Promise.withResolvers<never>(),
      observedForeground: false,
    };
    this.#activePrompts.set(id, active);
    // 回执只确认消息写入。等待前台终态以及此前的增量投影完成后再结算本地回合。
    const response = this.transport.agent
      .request(acp.methods.agent.session.prompt, request)
      .then(async ({ messageId }) => {
        // 即时命令可能直接报告 idle。只接受同一消息回显之后的候选终态。
        active.acceptedMessageId = messageId;
        if (active.echoedMessageId === messageId && active.idleAfterEcho)
          active.terminal.resolve(active.idleAfterEcho);
        receipt?.accept(messageId);
        const turnId = receipt?.turnId ?? request.idempotencyKey;
        if (turnId) await this.publishReceipt(id, turnId, messageId);
        const terminal = await active.terminal.promise;
        if (!terminal) throw new Error("ACP 连接已关闭，回合结果未知");
        if (terminal.stopReason === "error")
          throw new Error(
            "error" in terminal &&
              typeof terminal.error === "object" &&
              terminal.error !== null &&
              "message" in terminal.error &&
              typeof terminal.error.message === "string"
              ? terminal.error.message
              : "ACP 回合执行失败",
          );
        if (!terminal.stopReason) throw new Error("ACP Agent 未报告回合停止原因");
        return { stopReason: terminal.stopReason };
      })
      .finally(() => {
        this.#activePrompts.delete(id);
        const cancellation = this.#cancellations.get(id);
        if (cancellation?.sent) cancellation.finish();
      });
    return Promise.race([response, active.abandoned.promise]);
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<
    Omit<acp.SetSessionConfigOptionResponse, "configOptions"> & { configOptions: AcpConfigOption[] }
  > {
    this.assertSessionReady(sessionId);
    if (!this.#sessions.has(sessionId)) throw new Error("ACP 会话尚未加载");
    const request: acp.SetSessionConfigOptionRequest =
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean", value }
        : { sessionId, configId, type: "id", value };
    const result = await this.transport.agent.request(
      acp.methods.agent.session.setConfigOption,
      request,
    );
    const configOptions = projectAcpConfig(result.configOptions);
    await this.updateConfiguration(sessionId, configOptions);
    await this.drainUpdates();
    return { configOptions };
  }

  async closeSession(sessionId: string): Promise<void> {
    this.assertSessionReady(sessionId);
    try {
      await this.transport.agent.request(acp.methods.agent.session.close, { sessionId });
    } catch (error) {
      if (!(error instanceof acp.RequestError) || error.code !== -32002) throw error;
    }
    await this.drainUpdates();
    this.forgetSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.assertSessionReady(sessionId);
    if (!this.initialization.capabilities?.session?.delete)
      throw new Error("ACP agent 不支持原生会话删除");
    try {
      await this.transport.agent.request(acp.methods.agent.session.delete, { sessionId });
    } catch (error) {
      if (!(error instanceof acp.RequestError) || error.code !== -32002) throw error;
    }
    this.forgetSession(sessionId);
  }

  hasBackgroundWork(sessionId?: string): boolean {
    return this.metadata.hasBackgroundWork(sessionId);
  }

  async cancelBackground(sessionId: string, target: AcpBackgroundTarget): Promise<void> {
    this.assertSessionReady(sessionId);
    const work = this.metadata
      .read(sessionId)
      .background?.find((item) => item.kind === target.kind && item.id === target.id);
    // 每次以当前会话及实体能力为准。RPC 回执只表示接受取消，清单由后续通知更新。
    if (!this.#sessions.has(sessionId) || !work?.cancellable)
      throw new Error("ACP 后台工作已结束或不可停止");
    if (target.kind === "terminal") {
      await this.transport.agent.request(acp.methods.agent.terminal.cancel, {
        sessionId,
        terminalId: target.id,
      });
    } else {
      await this.transport.agent.request(acp.methods.agent.toolCall.cancel, {
        sessionId,
        toolCallId: target.id,
      });
    }
  }

  cancel(sessionId: string): Promise<void> {
    const existing = this.#cancellations.get(sessionId);
    if (existing) return existing.write;
    if (!this.#activePrompts.has(sessionId)) return Promise.resolve();
    const finished = Promise.withResolvers<undefined>();
    // 超时只结算目标回合为结果未知；原通知与响应收敛前禁止在同一会话发送新 prompt。
    const timeout = () => {
      if (cancellation.timedOut) return;
      cancellation.timedOut = true;
      clearTimeout(timer);
      const active = this.#activePrompts.get(sessionId);
      if (active) active.abandoned.reject(new Error("Agent 未确认取消，回合结果未知"));
      finished.resolve(undefined);
      if (this.#allSessionsAbandoned()) this.recycleAbandoned();
    };
    const timer = setTimeout(timeout, CANCEL_GRACE_MS);
    timer.unref();
    const cancellation: PendingCancellation = {
      sent: false,
      timedOut: false,
      write: finished.promise,
      finish: () => {
        clearTimeout(timer);
        if (this.#cancellations.get(sessionId) === cancellation)
          this.#cancellations.delete(sessionId);
        finished.resolve(undefined);
      },
    };
    this.#cancellations.set(sessionId, cancellation);
    cancellation.write = Promise.race([
      this.transport.agent.notify(acp.methods.agent.session.cancel, { sessionId }).then(() => {
        cancellation.sent = true;
        if (!this.#activePrompts.has(sessionId)) cancellation.finish();
      }, timeout),
      finished.promise,
    ]);
    return cancellation.write;
  }

  close(error?: unknown): void {
    this.authStatus.close();
    this.transport.close(error);
    this.#sessions.clear();
    this.metadata.clear();
  }
}
