const SNAPSHOT_RECOVERY_RETRY_INITIAL_MS = 1_000;
const SNAPSHOT_RECOVERY_RETRY_MAX_MS = 30_000;

type TaskRecoveryState = "disposed" | "ready" | "recovering" | "waiting_to_retry";
type RecoveryWarning = (error: unknown) => void;

const MAX_ACTIVE_TASK_RECOVERY_CONCURRENCY = 4;

function snapshotRecoveryDelay(attempt: number): number {
  return Math.min(
    SNAPSHOT_RECOVERY_RETRY_INITIAL_MS * 2 ** attempt,
    SNAPSHOT_RECOVERY_RETRY_MAX_MS,
  );
}

export class ActiveTaskSnapshotRecoveryController<T> {
  readonly #onWarning: RecoveryWarning;
  readonly #onRecovered: (taskId: string, value: T) => void;
  readonly #pendingTasks = new Map<string, symbol>();
  readonly #recoverTask: (taskId: string) => Promise<T | undefined>;
  #disposed = false;
  #recoveryAttempt = 0;
  #recoveryRunning = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    recoverTask: (taskId: string) => Promise<T | undefined>,
    onRecovered: (taskId: string, value: T) => void,
    onWarning: RecoveryWarning = () => undefined,
  ) {
    this.#recoverTask = recoverTask;
    this.#onRecovered = onRecovered;
    this.#onWarning = onWarning;
  }

  public dispose(): void {
    this.#disposed = true;
    this.cancelRecovery();
  }

  public cancelRecovery(): void {
    // 清除待恢复身份，保证在途请求返回后也无法发布失效会话的快照。
    this.#pendingTasks.clear();
    this.#clearRetryTimer();
    this.#recoveryAttempt = 0;
  }

  public forgetTask(taskId: string): void {
    this.#pendingTasks.delete(taskId);
    this.#resetWhenComplete();
  }

  public markRecovered(taskId: string): void {
    this.#pendingTasks.delete(taskId);
    this.#resetWhenComplete();
  }

  public requestRecovery(taskIds: readonly string[]): void {
    if (this.#disposed) {
      return;
    }
    for (const taskId of taskIds) {
      if (taskId.length > 0 && !this.#pendingTasks.has(taskId)) {
        this.#pendingTasks.set(taskId, Symbol());
      }
    }
    if (this.#pendingTasks.size > 0 && !this.#recoveryRunning && this.#retryTimer === undefined) {
      this.#startRecoveryAttempt();
    }
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  #resetWhenComplete(): void {
    if (this.#pendingTasks.size > 0 || this.#recoveryRunning) {
      return;
    }
    this.#clearRetryTimer();
    this.#recoveryAttempt = 0;
  }

  #scheduleRecoveryRetry(): void {
    if (this.#disposed || this.#pendingTasks.size === 0) {
      this.#resetWhenComplete();
      return;
    }
    const retryDelay = snapshotRecoveryDelay(this.#recoveryAttempt);
    this.#recoveryAttempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#startRecoveryAttempt();
    }, retryDelay);
  }

  #startRecoveryAttempt(): void {
    if (this.#disposed || this.#recoveryRunning || this.#pendingTasks.size === 0) {
      return;
    }
    this.#recoveryRunning = true;
    const tasks = [...this.#pendingTasks];
    let nextTaskIndex = 0;

    const recoverNext = async (): Promise<void> => {
      while (!this.#disposed) {
        const entry = tasks[nextTaskIndex];
        nextTaskIndex += 1;
        if (entry === undefined) {
          return;
        }
        const [taskId, request] = entry;
        if (this.#pendingTasks.get(taskId) !== request) {
          continue;
        }
        let response: T | undefined;
        try {
          response = await this.#recoverTask(taskId);
        } catch (error) {
          this.#onWarning(error);
          continue;
        }
        // 逐任务核对排队身份，取消后重新排队的同名任务不会接收旧快照。
        if (response === undefined || this.#pendingTasks.get(taskId) !== request) {
          continue;
        }
        try {
          // 单个成功结果立即校准 Activity，其他失败 Task 独立留待下一轮重试。
          this.#onRecovered(taskId, response);
          if (this.#pendingTasks.get(taskId) === request) this.#pendingTasks.delete(taskId);
        } catch (error) {
          this.#onWarning(error);
        }
      }
    };

    const workerCount = Math.min(MAX_ACTIVE_TASK_RECOVERY_CONCURRENCY, tasks.length);
    void Promise.all(Array.from({ length: workerCount }, recoverNext)).then(() => {
      this.#recoveryRunning = false;
      if (this.#disposed) {
        return;
      }
      if (this.#pendingTasks.size === 0) {
        this.#recoveryAttempt = 0;
        return;
      }
      this.#scheduleRecoveryRetry();
    });
  }
}

export class SnapshotRecoveryController<T> {
  readonly #onWarning: RecoveryWarning;
  readonly #onRecovered: (value: T) => void;
  readonly #onRecovering: () => void;
  readonly #recoverSnapshot: () => Promise<T | undefined>;
  #recoveryAttempt = 0;
  #recoveryGeneration = 0;
  #recoveryState: TaskRecoveryState = "ready";
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    recoverSnapshot: () => Promise<T | undefined>,
    onRecovered: (value: T) => void,
    onRecovering: () => void = () => undefined,
    onWarning: RecoveryWarning = () => undefined,
  ) {
    this.#recoverSnapshot = recoverSnapshot;
    this.#onRecovered = onRecovered;
    this.#onWarning = onWarning;
    this.#onRecovering = onRecovering;
  }

  public get isReady(): boolean {
    return this.#recoveryState === "ready";
  }

  public dispose(): void {
    this.#recoveryState = "disposed";
    this.#recoveryGeneration += 1;
    this.#clearRetryTimer();
  }

  public requestRecovery(): void {
    if (this.#recoveryState !== "ready") {
      return;
    }
    this.#startRecoveryAttempt();
  }

  public reset(): void {
    if (this.#recoveryState === "disposed") {
      return;
    }
    this.#clearRetryTimer();
    this.#recoveryAttempt = 0;
    this.#recoveryGeneration += 1;
    this.#recoveryState = "ready";
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  #scheduleRecoveryRetry(): void {
    if (this.#recoveryState === "disposed") {
      return;
    }
    this.#recoveryState = "waiting_to_retry";
    const retryDelay = snapshotRecoveryDelay(this.#recoveryAttempt);
    this.#recoveryAttempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#startRecoveryAttempt();
    }, retryDelay);
  }

  #startRecoveryAttempt(): void {
    if (this.#recoveryState === "disposed") {
      return;
    }
    this.#recoveryState = "recovering";
    this.#onRecovering();
    const recoveryGeneration = this.#recoveryGeneration;
    let recovery: Promise<T | undefined>;
    try {
      recovery = Promise.resolve(this.#recoverSnapshot());
    } catch (error) {
      this.#onWarning(error);
      if (recoveryGeneration === this.#recoveryGeneration) {
        this.#scheduleRecoveryRetry();
      }
      return;
    }
    void recovery
      .then((response) => {
        if (
          this.#recoveryState !== "recovering" ||
          recoveryGeneration !== this.#recoveryGeneration
        ) {
          return;
        }
        if (response === undefined) {
          this.#scheduleRecoveryRetry();
          return;
        }
        // 只允许当前代次的权威 Snapshot 完成恢复，过期请求不能覆盖新连接基线。
        this.#onRecovered(response);
      })
      .catch((error: unknown) => {
        this.#onWarning(error);
        if (
          this.#recoveryState === "recovering" &&
          recoveryGeneration === this.#recoveryGeneration
        ) {
          this.#scheduleRecoveryRetry();
        }
      });
  }
}
