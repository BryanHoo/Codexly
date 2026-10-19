import { isAbsolute } from "node:path";
import { Worker } from "node:worker_threads";

import {
  deserializeWorkerError,
  isSqliteCorruption,
  type SerializedSqliteWorkerError,
} from "./sqlite-state-helpers.js";
import { SQLITE_MIGRATIONS, type SqliteMigration } from "./sqlite-state-migrations.js";

export interface SqliteStateWorkerOptions {
  migrations?: readonly SqliteMigration[];
  requestTimeoutMs?: number;
  workerUrl?: URL;
}

const DEFAULT_SQLITE_REQUEST_TIMEOUT_MS = 10_000;
const SQLITE_RECONNECT_BASE_DELAY_MS = 100;
const SQLITE_RECONNECT_MAX_DELAY_MS = 5_000;

type ConnectionState = "disconnected" | "connecting" | "ready" | "failed" | "closing" | "closed";

type WorkerResponse =
  | Readonly<{ error: SerializedSqliteWorkerError; id: number; type: "response" }>
  | Readonly<{ id: number; result: unknown; type: "response" }>
  | Readonly<{ error: SerializedSqliteWorkerError; type: "fatal" }>
  | Readonly<{ type: "ready" }>;

type PendingRequest = Readonly<{
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}>;

// 统一管理 Worker 通信与恢复；项目、设置和队列等仓库接口共用同一连接。
export class SqliteStateWorkerClient {
  readonly #databasePath: string;
  readonly #options: SqliteStateWorkerOptions;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #requestTimeoutMs: number;
  #state: ConnectionState = "disconnected";
  #connection: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;
  #lastError: Error | undefined;
  #reconnectFailures = 0;
  #retryAt = 0;
  #nextRequestId = 1;
  #worker: Worker | undefined;
  #workerExit: Promise<number> | undefined;
  #workerExited = true;
  #workerError: Error | undefined;
  #termination: Promise<number> | undefined;

  private constructor(databasePath: string, options: SqliteStateWorkerOptions) {
    if (!isAbsolute(databasePath)) {
      throw new Error("SQLite database path must be absolute");
    }
    this.#databasePath = databasePath;
    this.#options = options;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_SQLITE_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new RangeError("SQLite request timeout must be a positive number");
    }
  }

  #startWorker(): Promise<void> {
    const worker = new Worker(
      this.#options.workerUrl ?? new URL("./sqlite-state-worker.js", import.meta.url),
      {
        workerData: {
          databasePath: this.#databasePath,
          migrations: this.#options.migrations ?? SQLITE_MIGRATIONS,
        },
      },
    );
    this.#worker = worker;
    this.#workerExited = false;
    this.#workerError = undefined;
    this.#termination = undefined;
    this.#workerExit = new Promise<number>((resolveExit) => {
      worker.once("exit", (code) => {
        if (this.#worker === worker) {
          this.#workerExited = true;
        }
        resolveExit(code);
      });
    });
    return new Promise<void>((resolveReady, rejectReady) => {
      let readySettled = false;
      const readyTimeout = setTimeout(() => {
        settleReadyError(
          new Error(
            `SQLite worker initialization timed out after ${String(this.#requestTimeoutMs)}ms`,
          ),
        );
      }, this.#requestTimeoutMs);
      const settleReady = (): void => {
        if (readySettled) {
          return;
        }
        readySettled = true;
        clearTimeout(readyTimeout);
        resolveReady();
      };
      const settleReadyError = (error: Error): void => {
        if (readySettled) {
          return;
        }
        readySettled = true;
        clearTimeout(readyTimeout);
        rejectReady(error);
      };
      const onMessage = (message: WorkerResponse): void => {
        // 旧代 Worker 的迟到消息不得触及新连接的请求表或生命周期。
        if (this.#worker !== worker) {
          return;
        }
        if (message.type === "ready") {
          settleReady();
          return;
        }
        if (message.type === "fatal") {
          const error = deserializeWorkerError(message.error);
          this.#workerError = error;
          settleReadyError(error);
          this.#disconnect(error);
          return;
        }
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
          return;
        }
        this.#pending.delete(message.id);
        clearTimeout(pending.timeout);
        if ("error" in message) {
          const error = deserializeWorkerError(message.error);
          pending.reject(error);
          if (isSqliteCorruption(error)) {
            this.#disconnect(error);
          }
        } else {
          pending.resolve(message.result);
        }
      };
      worker.on("message", onMessage);
      worker.once("error", (error: unknown) => {
        const workerError = error instanceof Error ? error : new Error(String(error));
        settleReadyError(workerError);
        if (this.#worker === worker) {
          this.#workerError = workerError;
          this.#disconnect(workerError);
        }
      });
      worker.once("exit", (code) => {
        const workerError = new Error(`SQLite worker exited with code ${String(code)}`);
        settleReadyError(workerError);
        if (this.#worker === worker) {
          this.#workerError ??= workerError;
          this.#disconnect(workerError);
        }
      });
    });
  }

  public static async open(
    databasePath: string,
    options: SqliteStateWorkerOptions = {},
  ): Promise<SqliteStateWorkerClient> {
    const repository = new SqliteStateWorkerClient(databasePath, options);
    try {
      await repository.#connect();
      return repository;
    } catch (error) {
      repository.#state = "closed";
      await repository.#stopWorker();
      repository.#rejectPending(
        error instanceof Error ? error : new Error("SQLite worker initialization failed"),
      );
      throw error;
    }
  }

  public close(): Promise<void> {
    // 所有关闭调用共享清理结果，避免后来的调用提前返回而 Worker 仍在运行。
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    const wasReady = this.#state === "ready";
    this.#state = "closing";
    try {
      if (wasReady) {
        await this.#sendRequest("close");
        await this.#waitForWorkerExit();
      } else {
        // 重建尚未就绪时直接终止；不能因初始化失败或退避而阻塞关闭。
        await this.#stopWorker();
        await this.#connection?.catch(() => undefined);
      }
    } finally {
      await this.#stopWorker();
      this.#rejectPending(new Error("SQLite repository is closed"));
      this.#state = "closed";
    }
  }

  public async call<TResult>(operation: string, payload?: unknown): Promise<TResult> {
    await this.#connect();
    // 等待连接期间可能发生关闭或退出；必须在发出操作前再次确认状态。
    if (this.#state !== "ready") {
      throw this.#state === "closing" || this.#state === "closed"
        ? new Error("SQLite repository is closed")
        : (this.#lastError ?? new Error("SQLite worker is unavailable"));
    }
    return this.#sendRequest<TResult>(operation, payload);
  }

  #sendRequest<TResult>(operation: string, payload?: unknown): Promise<TResult> {
    const worker = this.#worker;
    if (worker === undefined) {
      return Promise.reject(new Error("SQLite worker is unavailable"));
    }
    const id = this.#nextRequestId++;
    return new Promise<TResult>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.has(id)) {
          return;
        }
        const error = new Error(
          `SQLite worker operation ${operation} timed out after ${String(this.#requestTimeoutMs)}ms`,
        );
        // 已发出的写入可能已提交；统一拒绝所有在途操作，绝不自动重放。
        this.#rejectPending(error);
        this.#disconnect(error);
        if (this.#state === "disconnected") {
          // 超时后预热一次连接；失败会清除任务，后续请求可在退避到期后重试。
          void this.#connect().catch(() => undefined);
        } else {
          void this.#stopWorker();
        }
      }, this.#requestTimeoutMs);
      this.#pending.set(id, {
        reject: rejectRequest,
        resolve: (value) => {
          resolveRequest(value as TResult);
        },
        timeout,
      });
      try {
        worker.postMessage({ id, operation, payload });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timeout);
        rejectRequest(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #disconnect(error: Error): void {
    if (this.#state === "ready") {
      this.#state = isSqliteCorruption(error) ? "failed" : "disconnected";
      this.#lastError = error;
      void this.#stopWorker().catch(() => undefined);
    }
    this.#rejectPending(error);
  }

  #connect(): Promise<void> {
    if (this.#state === "closing" || this.#state === "closed") {
      return Promise.reject(new Error("SQLite repository is closed"));
    }
    if (this.#state === "ready") {
      return Promise.resolve();
    }
    if (this.#connection !== undefined) {
      return this.#connection;
    }
    if (this.#lastError !== undefined && (this.#state === "failed" || Date.now() < this.#retryAt)) {
      return Promise.reject(this.#lastError);
    }

    this.#state = "connecting";
    // 单次重建任务由仓库实例持有，成功和失败均释放，避免 rejected Promise 永久阻断。
    const connection = this.#replaceWorker()
      .then(() => {
        if (this.#state !== "connecting") {
          throw new Error("SQLite repository is closed");
        }
        this.#state = "ready";
        this.#lastError = undefined;
        this.#reconnectFailures = 0;
        this.#retryAt = 0;
      })
      .catch(async (error: unknown) => {
        await this.#stopWorker();
        const failure = error instanceof Error ? error : new Error(String(error));
        if (this.#state === "connecting") {
          this.#lastError = failure;
          this.#state = isSqliteCorruption(failure) ? "failed" : "disconnected";
          // 仅在有新请求时重试；窗口内快速失败，不启动后台循环或额外计时器。
          const delay = Math.min(
            SQLITE_RECONNECT_MAX_DELAY_MS,
            SQLITE_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(this.#reconnectFailures++, 6),
          );
          this.#retryAt = Date.now() + delay;
        }
        throw failure;
      })
      .finally(() => {
        this.#connection = undefined;
      });
    this.#connection = connection;
    return connection;
  }

  async #replaceWorker(): Promise<void> {
    await this.#stopWorker();
    if (this.#state !== "connecting") {
      throw new Error("SQLite repository is closed");
    }
    await this.#startWorker();
    if (this.#workerError !== undefined) {
      throw this.#workerError;
    }
  }

  async #stopWorker(): Promise<void> {
    if (this.#worker !== undefined && !this.#workerExited) {
      this.#termination ??= this.#worker.terminate();
      await this.#termination;
    }
  }

  async #waitForWorkerExit(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        this.#workerExit,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `SQLite worker shutdown timed out after ${String(this.#requestTimeoutMs)}ms`,
              ),
            );
          }, this.#requestTimeoutMs);
        }),
      ]);
      if (code !== 0) {
        throw new Error(`SQLite worker exited with code ${String(code)} during shutdown`);
      }
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
