import type { AcpClientCallbacks, AcpConnection } from "./connection.js";

const IDLE_CONNECTION_MS = 30_000;

/** 连接归属、暖退订和回收共享一个生命周期，旧连接的通知不能进入新连接。 */
export class AcpProviderConnection {
  readonly sessions = new Map<string, string>();
  readonly detached = new Set<string>();
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
      if (agent.isAwaitingCancellation(session) || (!ephemeral && !agent.canRestoreSessions)) {
        this.detached.add(taskId);
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
          onUpdate: (notification) => {
            if (current()) return this.callbacks.onUpdate?.(notification);
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
    if (!agent || this.#closed || !this.isIdle()) return;
    if (agent.recycleAbandoned()) {
      this.#clear();
      return;
    }
    // 普通退订不能销毁不可恢复的会话，即使所有视图都关闭或连接已满。
    if (!agent.canRestoreSessions) return;
    if (this.detached.size && agent.atSessionCapacity) {
      this.#clear();
      agent.close();
    } else if (this.#allDetached && !this.#idleTimer) {
      this.#idleTimer = setTimeout(() => {
        this.#idleTimer = undefined;
        if (this.#instance === agent && this.isIdle() && this.#allDetached) {
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
    this.onClear();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#clearTimer();
    const connection = await this.#pending?.catch(() => undefined);
    connection?.close();
  }
}
