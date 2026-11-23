import { projectAcpConfig } from "./session-options.js";
import type { AcpBackgroundTarget, AcpConfigOption } from "@codexly/protocol";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpAuthStatusTracker } from "./auth-status.js";
import { AcpSessionMetadataStore, type AcpSessionMetadata } from "./session-metadata.js";

const CANCEL_GRACE_MS = 5_000;
const SESSION_CAPACITY = 64;

interface ActivePrompt {
  abandoned: PromiseWithResolvers<never>;
  foregroundActive: boolean;
}

interface PendingCancellation {
  sent: boolean;
  timedOut: boolean;
  write: Promise<void>;
  finish(): void;
}

export interface AcpClientCallbacks {
  /** 更新直接增量交付；上层按 sessionId 路由，禁止在这里重建整个历史。 */
  onUpdate?(notification: acp.SessionNotification, historical: boolean): void | Promise<void>;
  supportsSubagents?: boolean;
  subagentRoot?(sessionId: string): string | undefined;
  resetSubagentWork?(rootSessionId: string): void;
  onSessionState?(sessionId: string, state: AcpSessionMetadata): void | Promise<void>;
  requestElicitation?(
    request: acp.CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<acp.CreateElicitationResponse>;
  onElicitationComplete?(id: string): void;
  requestPermission?(
    request: acp.RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse>;
}

/** 通过 ACP 稳定接口及 Agent 主动公布的扩展通信。 */
export class AcpConnection {
  readonly #activePrompts = new Map<string, ActivePrompt>();
  readonly #cancellations = new Map<string, PendingCancellation>();
  readonly #sessions = new Set<string>();
  readonly supportsSteering: boolean;
  #pendingBindings = 0;

  private constructor(
    readonly initialization: acp.InitializeResponse,
    readonly transport: acp.ClientConnection,
    readonly drainUpdates: () => Promise<void>,
    private readonly authStatus: AcpAuthStatusTracker,
    private readonly replaying: Set<string>,
    private readonly resetSubagentWork: (rootSessionId: string) => void,
    private readonly metadata: AcpSessionMetadataStore,
    private readonly publishForeground: (
      sessionId: string,
      state: "running" | "idle",
    ) => Promise<void>,
    private readonly updateConfiguration: (
      sessionId: string,
      options: AcpConfigOption[],
      commands?: acp.AvailableCommand[],
    ) => Promise<void>,
  ) {
    this.supportsSteering = AcpSessionMetadataStore.supportsSteering(initialization);
    const release = () => {
      // SDK 关闭连接时会拒绝所有尚未完成的 prompt 请求。
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
    const replaying = new Set<string>();
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
    const transport: acp.ClientConnection = acp
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
          const { sessionId } = params;
          // 子会话与根会话共用同一个 load 响应边界，嵌套公告也按根会话判定新旧。
          const root = callbacks.subagentRoot?.(sessionId);
          const historical = replaying.has(root ?? sessionId);
          // v1 回放的配置、命令和用量同样是 Agent 确认的会话元数据。
          const state = root === undefined ? metadata.update(params) : undefined;
          if (state) await callbacks.onSessionState?.(sessionId, state);
          await callbacks.onUpdate?.(params, historical);
        });
      })
      .onRequest(acp.methods.client.elicitation.create, ({ params, signal }) => {
        // 能力只在有交互路由的连接公布；后台设置与辅助任务不弹出聊天待办。
        if (!callbacks.requestElicitation || (params.mode !== "form" && params.mode !== "url"))
          throw acp.RequestError.invalidParams();
        if ("sessionId" in params === "requestId" in params) throw acp.RequestError.invalidParams();
        return callbacks.requestElicitation(params, AbortSignal.any([signal, transport.signal]));
      })
      .onNotification(acp.methods.client.elicitation.complete, ({ params }) => {
        callbacks.onElicitationComplete?.(params.elicitationId);
      })
      .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => {
        // 不提供隐式批准；UI 必须保留 agent 原始 optionId 和权限含义。
        return (
          callbacks.requestPermission?.(params, AbortSignal.any([signal, transport.signal])) ?? {
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
        clientInfo: { name: "codexly", version: "0.53.0" },
        // 文件与终端由 agent 自行执行，只有实现了对应客户端方法才能声明能力。
        clientCapabilities: {
          session: {
            configOptions: { boolean: {} },
            // ACP v1 通过显式能力对象启用实时通知和压缩历史回放。
            ...(callbacks.onUpdate ? { notices: {}, compaction: {} } : {}),
          },
          ...(callbacks.supportsSubagents ? { subagents: {} } : {}),
          ...(callbacks.requestElicitation ? { elicitation: { form: {}, url: {} } } : {}),
        },
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
        (sessionId) => callbacks.resetSubagentWork?.(sessionId),
        metadata,
        (sessionId, foreground) =>
          enqueue(async () => {
            const state = metadata.foreground(sessionId, foreground);
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
  get canCloseSessions(): boolean {
    return !!this.initialization.agentCapabilities?.sessionCapabilities?.close;
  }
  get canRestoreSessions(): boolean {
    return this.initialization.agentCapabilities?.loadSession === true;
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
    const marker = this.initialization.agentCapabilities?._meta?.["authStatus"];
    return this.authStatus.read(marker !== undefined && marker !== null);
  }
  readSessionState(sessionId: string): AcpSessionMetadata {
    const state = this.metadata.read(sessionId);
    return this.supportsSteering ? { ...state, canSteer: true } : state;
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
      await this.updateConfiguration(result.sessionId, configOptions, undefined);
      this.#sessions.add(result.sessionId);
      await this.drainUpdates();
      return { ...result, configOptions };
    } finally {
      this.#finishBinding();
    }
  }

  async resumeSession(
    request: acp.ResumeSessionRequest,
    replay = false,
  ): Promise<
    Omit<acp.ResumeSessionResponse, "configOptions"> & { configOptions: AcpConfigOption[] }
  > {
    const { sessionId } = request;
    if (!this.canRestoreSessions) throw new Error("ACP Agent 未声明会话能力");
    this.assertSessionReady(sessionId);
    if (this.#activePrompts.has(sessionId)) throw new Error("会话正在进行中");
    // 必须保持原生会话身份；错误直接返回，禁止回退 newSession 丢失上下文。
    this.#beginBinding(sessionId);
    this.resetSubagentWork(sessionId);
    const load = replay || !this.initialization.agentCapabilities?.sessionCapabilities?.resume;
    if (load) this.replaying.add(sessionId);
    try {
      // v1 的 load 响应即回放边界；resume 仅在明确声明且无需正文时使用。
      const params = request;
      const result = load
        ? await this.transport.agent.request(acp.methods.agent.session.load, {
            ...params,
            mcpServers: params.mcpServers ?? [],
          })
        : await this.transport.agent.request(acp.methods.agent.session.resume, params);
      this.replaying.delete(sessionId);
      await this.drainUpdates();

      const configOptions = projectAcpConfig(result.configOptions ?? []);
      await this.updateConfiguration(sessionId, configOptions, undefined);
      this.#sessions.add(sessionId);
      return { ...result, configOptions };
    } catch (error) {
      // 恢复失败时，丢弃请求期间收集的实时子会话工作状态。
      this.resetSubagentWork(sessionId);
      throw error;
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

  async prompt(request: acp.PromptRequest): Promise<{ stopReason: string }> {
    const id = request.sessionId;
    this.assertSessionReady(id);
    if (!this.#sessions.has(id)) throw new Error("ACP 会话尚未加载");
    if (this.#activePrompts.has(id)) throw new Error("会话已有输入进行中");
    const active: ActivePrompt = {
      abandoned: Promise.withResolvers<never>(),
      foregroundActive: true,
    };
    this.#activePrompts.set(id, active);
    // v1 响应代表整个回合结束，不存在 v2 的消息接受回执与前台终态等待。
    // 请求进入传输后不自动重发；返回前等待已接收的增量完成投影。
    const response = (async () => {
      try {
        const result = await this.transport.agent.request(
          acp.methods.agent.session.prompt,
          request,
        );
        await this.drainUpdates();
        return { stopReason: result.stopReason };
      } finally {
        try {
          if (!this.transport.signal.aborted) await this.publishForeground(id, "idle");
        } finally {
          this.#activePrompts.delete(id);
          const cancellation = this.#cancellations.get(id);
          if (cancellation?.sent) cancellation.finish();
        }
      }
    })();
    void this.publishForeground(id, "running").catch((error: unknown) => {
      this.close(error);
    });
    return Promise.race([response, active.abandoned.promise]);
  }

  canElicitInSession(sessionId: string): boolean {
    return this.#activePrompts.has(sessionId) && !this.#cancellations.has(sessionId);
  }

  canSteerSession(sessionId: string): boolean {
    return (
      this.supportsSteering &&
      this.#activePrompts.get(sessionId)?.foregroundActive === true &&
      !this.#cancellations.has(sessionId)
    );
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
        : { sessionId, configId, value };
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
    if (!this.canCloseSessions) {
      // 未实现 close 的 v1 Agent 继续计入连接容量，直到整个连接回收。
      return;
    }
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
    if (!this.initialization.agentCapabilities?.sessionCapabilities?.delete)
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

  cancelBackground(sessionId: string, target: AcpBackgroundTarget): Promise<void> {
    this.assertSessionReady(sessionId);
    // v1 没有 Agent 侧 terminal/cancel 或 tool_call/cancel 标准方法。
    void target;
    return Promise.reject(new Error("ACP v1 不支持单项后台工作取消"));
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
