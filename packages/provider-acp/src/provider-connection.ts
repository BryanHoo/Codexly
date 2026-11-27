import type { AcpBackgroundTarget } from "@codexly/protocol";
import { AcpSubagentSessions } from "./subagent-sessions.js";
import type { AcpClientCallbacks, AcpConnection } from "./connection.js";

const IDLE_CONNECTION_MS = 30_000;

/** 连接归属、暖退订和回收共享一个生命周期，旧连接的通知不能进入新连接。 */
export class AcpProviderConnection {
  readonly subagents = new AcpSubagentSessions();
  readonly sessions = new Map<string, string>();
  readonly detached = new Set<string>();
  readonly #disposable = new Set<string>();
  #pending: Promise<AcpConnection> | undefined;
  #instance: AcpConnection | undefined;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  #previews = 0;
  #warmedByPreview = false;

  constructor(
    private readonly connect: (callbacks: AcpClientCallbacks) => Promise<AcpConnection>,
    private readonly callbacks: AcpClientCallbacks,
    private readonly isIdle: () => boolean,
    private readonly onClear: () => void,
  ) {}

  get instance(): AcpConnection | undefined {
    return this.#instance;
  }

  async preview<T>(run: (connection: AcpConnection) => Promise<T>): Promise<T> {
    this.#previews++;
    this.#warmedByPreview = true;
    this.#clearTimer();
    try {
      const connection = await this.get();
      if (!connection.canCloseSessions) throw new Error("ACP Agent 无法释放预览会话");
      return await run(connection);
    } finally {
      this.#previews--;
      this.recycleIdle();
    }
  }

  async deleteSession(taskId: string, sessionId: string | null): Promise<void> {
    if (sessionId) {
      await (await this.get()).deleteSession(sessionId);
      this.subagents.forget(sessionId);
    }
    this.sessions.delete(taskId);
    this.detached.delete(taskId);
  }

  async cancelBackground(taskId: string, target: AcpBackgroundTarget): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!this.#instance || !session) throw new Error("ACP 会话已断开");
    await this.#instance.cancelBackground(session, target);
  }

  async releaseSession(taskId: string, ephemeral: boolean): Promise<boolean> {
    const session = this.sessions.get(taskId);
    const agent = this.#instance;
    if (session && agent) {
      // 正在隔离的会话只能退订视图；持久会话无恢复能力时也保留原绑定。
      // v1 未声明 close 时保留暖绑定，避免把未释放的会话重新加载并重复占用容量。
      if (
        agent.isAwaitingCancellation(session) ||
        agent.hasBackgroundWork(session) ||
        this.subagents.hasWork(session) ||
        !agent.canCloseSessions ||
        (!ephemeral && !agent.canRestoreSessions)
      ) {
        this.detached.add(taskId);
        if (ephemeral) this.#disposable.add(taskId);
        return false;
      }
      await agent.closeSession(session);
    }
    if (session) this.subagents.forget(session);
    this.sessions.delete(taskId);
    return true;
  }

  get(): Promise<AcpConnection> {
    if (this.#closed) return Promise.reject(new Error("ACP Provider 已关闭"));
    if (!this.#pending) {
      const current = (): boolean => this.#pending === pending;
      // 先登记连接身份，再允许连接器回调；握手与路由恢复也受同一身份约束。
      const pending: Promise<AcpConnection> = Promise.resolve().then(() =>
        this.connect({
          supportsSubagents: this.callbacks.supportsSubagents === true,
          subagentRoot: (sessionId) =>
            current() ? this.subagents.get(sessionId)?.rootSessionId : undefined,
          resetSubagentWork: (root) => {
            if (current()) this.subagents.resetWork(root);
          },
          onSessionState: (...args) => {
            if (current()) return this.callbacks.onSessionState?.(...args);
          },
          onUpdate: (...args) => {
            if (current()) return this.callbacks.onUpdate?.(...args);
          },
          ...(this.callbacks.requestElicitation
            ? ({
                requestElicitation: (request, signal) =>
                  (current() ? this.callbacks.requestElicitation?.(request, signal) : undefined) ??
                  Promise.resolve({ action: "cancel" }),
                onElicitationComplete: (id) => {
                  if (current()) this.callbacks.onElicitationComplete?.(id);
                },
              } satisfies Pick<AcpClientCallbacks, "requestElicitation" | "onElicitationComplete">)
            : {}),
          requestPermission: (request, signal) =>
            (current() ? this.callbacks.requestPermission?.(request, signal) : undefined) ??
            Promise.resolve({ outcome: { outcome: "cancelled" } }),
        }),
      );
      this.#pending = pending;
      void pending
        .then((connection) => {
          if (current()) this.#instance = connection;
          return connection.closed;
        })
        .catch(() => undefined)
        .then(() => {
          if (current()) this.#clear();
        });
    }
    return this.#pending;
  }

  get #allDetached(): boolean {
    return (
      (this.#warmedByPreview || this.detached.size > 0) && this.detached.size === this.sessions.size
    );
  }

  recycleIdle(): void {
    const agent = this.#instance;
    if (
      !agent ||
      this.#closed ||
      this.#previews > 0 ||
      !this.isIdle() ||
      agent.hasBackgroundWork() ||
      this.subagents.hasWork()
    )
      return;
    if (agent.recycleAbandoned()) {
      this.#clear();
      return;
    }
    // 普通退订不能销毁不可恢复的会话，即使所有视图都关闭或连接已满。
    // 全部绑定均为已结束的临时任务时，无需恢复能力也能整体回收。
    // 混有持久任务的连接仍保持保守策略，不能丢失无法恢复的上下文。
    const disposable = this.#allDetached && this.#disposable.size === this.sessions.size;
    if (this.sessions.size && !agent.canRestoreSessions && !disposable) return;
    if (this.detached.size && agent.atSessionCapacity) {
      this.#clear();
      agent.close();
    } else if (this.#allDetached && !this.#idleTimer) {
      this.#idleTimer = setTimeout(() => {
        this.#idleTimer = undefined;
        if (
          this.#instance === agent &&
          this.#previews === 0 &&
          this.isIdle() &&
          this.#allDetached &&
          !agent.hasBackgroundWork() &&
          !this.subagents.hasWork()
        ) {
          this.#clear();
          agent.close();
        }
      }, IDLE_CONNECTION_MS);
      this.#idleTimer.unref();
    } else if (!this.#allDetached) {
      this.#clearTimer();
    }
  }

  #clearTimer(): void {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  #clear(): void {
    this.#clearTimer();
    this.#pending = undefined;
    this.#instance = undefined;
    this.#warmedByPreview = false;
    this.sessions.clear();
    this.subagents.clear();
    this.detached.clear();
    this.#disposable.clear();
    this.onClear();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#clearTimer();
    const connection = await this.#pending?.catch(() => undefined);
    connection?.close();
  }
}
