import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";

export interface CodexlyAccessOptions {
  pairingCode: string;
  sessionTtlMs?: number;
}

type AccessSessionServiceDependencies = Readonly<{
  maxFailureWindows?: number;
  maxSessions?: number;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}>;

type PairAccessResult =
  | Readonly<{ expiresAt: number | null; sessionId: string; status: "paired" }>
  | Readonly<{ status: "failed" | "rate_limited" }>;

interface FailureWindow {
  count: number;
  startedAt: number;
}
type Session = Readonly<{
  createdAt: number;
  expiresAt: number | null;
  invalidationListeners: Set<() => void>;
}>;

const FAILURE_LIMIT = 5;
const FAILURE_WINDOW_MS = 60_000;
const DEFAULT_MAX_FAILURE_WINDOWS = 1_000;
const DEFAULT_MAX_SESSIONS = 1_000;

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

export class AccessSessionService {
  readonly #failureWindows = new Map<string, FailureWindow>();
  readonly #maxFailureWindows: number;
  readonly #maxSessions: number;
  readonly #now: () => number;
  readonly #pairingCode: string;
  readonly #randomBytes: (size: number) => Buffer;
  readonly #sessionTtlMs: number | undefined;
  readonly #sessions = new Map<string, Session>();
  readonly #cleanupTimer: ReturnType<typeof setInterval>;

  public constructor(
    options: CodexlyAccessOptions,
    dependencies: AccessSessionServiceDependencies = {},
  ) {
    if (
      options.sessionTtlMs !== undefined &&
      (!Number.isSafeInteger(options.sessionTtlMs) || options.sessionTtlMs <= 0)
    ) {
      throw new Error("sessionTtlMs must be a positive safe integer");
    }
    this.#pairingCode = options.pairingCode;
    this.#sessionTtlMs = options.sessionTtlMs;
    this.#maxFailureWindows = dependencies.maxFailureWindows ?? DEFAULT_MAX_FAILURE_WINDOWS;
    this.#maxSessions = dependencies.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.#now = dependencies.now ?? Date.now;
    this.#randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
    this.#cleanupTimer = setInterval(
      () => {
        this.#pruneExpired(this.#now());
      },
      // 校验请求和 WebSocket 定时器负责即时失效；后台只需按失败窗口周期回收有界状态。
      FAILURE_WINDOW_MS,
    );
    this.#cleanupTimer.unref();
  }

  public pair(code: string, remoteAddress: string): PairAccessResult {
    const now = this.#now();
    this.#pruneExpired(now);
    const currentWindow = this.#failureWindows.get(remoteAddress);
    if (currentWindow !== undefined && currentWindow.count >= FAILURE_LIMIT) {
      return { status: "rate_limited" };
    }
    if (!constantTimeEqual(this.#pairingCode, code)) {
      // 失败计数按远端地址隔离，并在写入前裁剪以保持内存上界。
      this.#ensureCapacity(this.#failureWindows, this.#maxFailureWindows);
      const failureWindow = this.#failureWindows.get(remoteAddress);
      if (failureWindow === undefined) {
        this.#failureWindows.set(remoteAddress, { count: 1, startedAt: now });
      } else {
        failureWindow.count += 1;
      }
      return { status: "failed" };
    }

    this.#ensureCapacity(this.#sessions, this.#maxSessions, (id) => {
      this.logout(id);
    });
    const sessionId = this.#randomBytes(32).toString("base64url");
    // 未配置 TTL 的 Session 只受当前 Server 生命周期约束，关闭时仍会统一清空。
    const expiresAt = this.#sessionTtlMs === undefined ? null : now + this.#sessionTtlMs;
    this.#sessions.set(sessionId, { createdAt: now, expiresAt, invalidationListeners: new Set() });
    return { expiresAt, sessionId, status: "paired" };
  }

  public validate(sessionId: string | undefined): boolean {
    return this.expiresAt(sessionId) !== undefined;
  }

  public expiresAt(sessionId: string | undefined): number | null | undefined {
    if (sessionId === undefined) {
      return undefined;
    }
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    // 认证只检查签发时固定的绝对期限，请求不得续期。
    if (session.expiresAt !== null && session.expiresAt <= this.#now()) {
      this.logout(sessionId);
      return undefined;
    }
    return session.expiresAt;
  }

  public logout(sessionId: string | undefined): void {
    if (sessionId !== undefined) {
      const session = this.#sessions.get(sessionId);
      this.#sessions.delete(sessionId);
      // 先撤销认证，再同步停止所有关联连接，避免后续广播继续交付数据。
      for (const listener of session?.invalidationListeners ?? []) {
        listener();
      }
      session?.invalidationListeners.clear();
    }
  }

  public onInvalidated(sessionId: string | undefined, listener: () => void): () => void {
    const session = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
    if (!this.validate(sessionId) || session === undefined) {
      listener();
      return () => undefined;
    }
    session.invalidationListeners.add(listener);
    return () => {
      session.invalidationListeners.delete(listener);
    };
  }

  public diagnostics(): Readonly<{ failureWindows: number; sessions: number }> {
    return { failureWindows: this.#failureWindows.size, sessions: this.#sessions.size };
  }

  public close(): void {
    clearInterval(this.#cleanupTimer);
    this.#failureWindows.clear();
    for (const sessionId of this.#sessions.keys()) {
      this.logout(sessionId);
    }
  }

  #ensureCapacity<T>(
    store: Map<string, T>,
    maximum: number,
    remove: (key: string) => void = (key) => {
      store.delete(key);
    },
  ): void {
    while (store.size >= maximum) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      remove(oldestKey);
    }
  }

  #pruneExpired(now: number): void {
    for (const [remoteAddress, window] of this.#failureWindows) {
      if (window.startedAt + FAILURE_WINDOW_MS <= now) {
        this.#failureWindows.delete(remoteAddress);
      }
    }
    for (const [sessionId, session] of this.#sessions) {
      if (session.expiresAt !== null && session.expiresAt <= now) {
        this.logout(sessionId);
      }
    }
  }
}
