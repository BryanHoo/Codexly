import type { AcpClientCallbacks, AcpConnection } from "./connection.js";

const IDLE_CONNECTION_MS = 30_000;

/** 连接归属、暖退订和回收共享一个生命周期，旧连接的通知不能进入新连接。 */
export class AcpProviderConnection {
  readonly sessions = new Map<string, string>();
  readonly detached = new Set<string>();
  readonly #disposable = new Set<string>();
  #pending: Promise<AcpConnection> | undefined;
  #instance: AcpConnection | undefined;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(
    private readonly connect: (callbacks: AcpClientCallbacks) => Promise<AcpConnection>,
    private readonly callbacks: AcpClientCallbacks,
    private readonly isIdle: () => boolean,
    private readonly onClear: () => void,
  ) {}

  get instance(): AcpConnection | undefined {
    return this.#instance;
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
        !agent.canCloseSessions ||
        (!ephemeral && !agent.canRestoreSessions)
      ) {
        this.detached.add(taskId);
        if (ephemeral) this.#disposable.add(taskId);
        return false;
      }
      await agent.closeSession(session);
    }
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
          onSessionState: (...args) => {
            if (current()) return this.callbacks.onSessionState?.(...args);
          },
          onUpdate: (...args) => {
            if (current()) return this.callbacks.onUpdate?.(...args);
          },
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
    return this.detached.size > 0 && this.detached.size === this.sessions.size;
  }

  recycleIdle(): void {
    const agent = this.#instance;
    if (!agent || this.#closed || !this.isIdle() || agent.hasBackgroundWork()) return;
    if (agent.recycleAbandoned()) {
      this.#clear();
      return;
    }
    // 普通退订不能销毁不可恢复的会话，即使所有视图都关闭或连接已满。
    // 全部绑定均为已结束的临时任务时，无需恢复能力也能整体回收。
    // 混有持久任务的连接仍保持保守策略，不能丢失无法恢复的上下文。
    const disposable = this.#allDetached && this.#disposable.size === this.sessions.size;
    if (!agent.canRestoreSessions && !disposable) return;
    if (this.detached.size && agent.atSessionCapacity) {
      this.#clear();
      agent.close();
    } else if (this.#allDetached && !this.#idleTimer) {
      this.#idleTimer = setTimeout(() => {
        this.#idleTimer = undefined;
        if (
          this.#instance === agent &&
          this.isIdle() &&
          this.#allDetached &&
          !agent.hasBackgroundWork()
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
    this.sessions.clear();
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
