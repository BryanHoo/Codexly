import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpAuthStatusTracker } from "./auth-status.js";
import { AcpSessionMetadataStore, type AcpSessionMetadata } from "./session-metadata.js";

export interface AcpClientCallbacks {
  /** 更新直接增量交付；上层按 sessionId 路由，禁止在这里重建整个历史。 */
  onUpdate?(notification: acp.SessionNotification): void | Promise<void>;
  onSessionState?(sessionId: string, state: AcpSessionMetadata): void | Promise<void>;
  requestPermission?(
    request: acp.RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<acp.RequestPermissionResponse>;
}

/** 仅对接 ACP 稳定接口，不解释 Codex 或 Claude 的私有协议。 */
export class AcpConnection {
  readonly #activePrompts = new Set<string>();
  readonly #sessions = new Set<string>();
  #pendingBindings = 0;

  private constructor(
    readonly initialization: acp.InitializeResponse,
    readonly transport: acp.ClientConnection,
    readonly drainUpdates: () => Promise<void>,
    private readonly authStatus: AcpAuthStatusTracker,
    private readonly metadata: AcpSessionMetadataStore,
    private readonly updateConfiguration: (
      sessionId: string,
      options: acp.SessionConfigOption[],
    ) => Promise<void>,
  ) {}

  static async connect(
    stream: acp.Stream,
    callbacks: AcpClientCallbacks = {},
    options: { handshakeTimeoutMs?: number } = {},
  ): Promise<AcpConnection> {
    let updates = Promise.resolve();
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
          const state = metadata.update(params);
          if (state) await callbacks.onSessionState?.(params.sessionId, state);
          return callbacks.onUpdate?.(params);
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
        clientInfo: { name: "codexly", version: "0.53.0" },
        // 文件与终端由 agent 自行执行，只有实现了对应客户端方法才能声明能力。
        clientCapabilities: { session: { configOptions: { boolean: {} } } },
      });
      if (initialization.protocolVersion !== acp.PROTOCOL_VERSION)
        throw new Error(`不支持 ACP 协议版本 ${String(initialization.protocolVersion)}`);
      void transport.closed.then(
        () => {
          authStatus.close();
          metadata.clear();
        },
        () => {
          authStatus.close();
          metadata.clear();
        },
      );
      return new AcpConnection(
        initialization,
        transport,
        () => updates,
        authStatus,
        metadata,
        (id, options) =>
          enqueue(async () => {
            const state = metadata.configure(id, options);
            if (state) await callbacks.onSessionState?.(id, state);
          }),
      );
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
  readAuthStatus() {
    const marker = this.initialization.agentCapabilities?._meta?.["authStatus"];
    return this.authStatus.read(marker !== undefined && marker !== null);
  }
  readSessionState(sessionId: string): AcpSessionMetadata {
    return this.metadata.read(sessionId);
  }
  cacheSessionConfiguration(sessionId: string, options: acp.SessionConfigOption[]): Promise<void> {
    // 默认值初始化只能提交已经由 ACP 响应确认的完整选项，不建立另一份配置缓存。
    return this.updateConfiguration(sessionId, options);
  }
  forgetSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
    this.metadata.delete(sessionId);
  }

  async newSession(request: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.#pendingBindings++;
    try {
      const result = await this.transport.agent.request(acp.methods.agent.session.new, request);
      await this.updateConfiguration(
        result.sessionId,
        result.configOptions ?? this.metadata.read(result.sessionId).configOptions,
      );
      this.#sessions.add(result.sessionId);
      await this.drainUpdates();
      return result;
    } finally {
      this.#finishBinding();
    }
  }

  async loadSession(request: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    if (!this.initialization.agentCapabilities?.loadSession)
      throw new Error("此 ACP agent 不支持 session/load，无法加载原会话");
    if (this.#activePrompts.has(request.sessionId)) throw new Error("会话正在进行中");
    // 必须保持原生会话身份；错误直接返回，禁止回退 newSession 丢失上下文。
    this.#pendingBindings++;
    try {
      const result = await this.transport.agent.request(acp.methods.agent.session.load, request);
      await this.updateConfiguration(
        request.sessionId,
        result.configOptions ?? this.metadata.read(request.sessionId).configOptions,
      );
      this.#sessions.add(request.sessionId);
      await this.drainUpdates();
      return result;
    } finally {
      this.#finishBinding();
    }
  }
  #finishBinding(): void {
    // 并发 new/load 全部结束后才清理未绑定缓存，不能删除另一请求提前公布的命令。
    if (--this.#pendingBindings === 0) this.metadata.retain(this.#sessions);
  }

  async prompt(request: acp.PromptRequest): Promise<acp.PromptResponse> {
    if (!this.#sessions.has(request.sessionId)) throw new Error("ACP 会话尚未加载");
    if (this.#activePrompts.has(request.sessionId)) throw new Error("会话已有输入进行中");
    this.#activePrompts.add(request.sessionId);
    try {
      // prompt 不做自动重试，断线后的提交结果不确定，重发可能重复执行工具。
      const response = await this.transport.agent.request(
        acp.methods.agent.session.prompt,
        request,
      );
      await this.drainUpdates();
      return response;
    } finally {
      this.#activePrompts.delete(request.sessionId);
    }
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<acp.SetSessionConfigOptionResponse> {
    if (!this.#sessions.has(sessionId)) throw new Error("ACP 会话尚未加载");
    const request: acp.SetSessionConfigOptionRequest =
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean", value }
        : { sessionId, configId, value };
    const result = await this.transport.agent.request(
      acp.methods.agent.session.setConfigOption,
      request,
    );
    await this.updateConfiguration(sessionId, result.configOptions);
    await this.drainUpdates();
    return result;
  }

  async closeSession(sessionId: string): Promise<void> {
    if (!this.initialization.agentCapabilities?.sessionCapabilities?.close)
      throw new Error("ACP agent 不支持 session/close");
    try {
      await this.transport.agent.request(acp.methods.agent.session.close, { sessionId });
    } catch (error) {
      if (!(error instanceof acp.RequestError) || error.code !== -32002) throw error;
    }
    await this.drainUpdates();
    this.forgetSession(sessionId);
  }

  cancel(sessionId: string): Promise<void> {
    return this.transport.agent.notify(acp.methods.agent.session.cancel, { sessionId });
  }

  close(error?: unknown): void {
    this.authStatus.close();
    this.transport.close(error);
    this.#sessions.clear();
    this.metadata.clear();
  }
}
