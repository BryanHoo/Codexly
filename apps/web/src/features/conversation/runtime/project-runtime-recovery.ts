import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@code-agent/protocol";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import { AgentEventBuffer } from "./task-runtime.js";
import type { TaskStore } from "./task-store.js";

import type { RecoverTaskSnapshot, TaskRecoveryState } from "./project-runtime-history.js";
import {
  SNAPSHOT_RECOVERY_RETRY_INITIAL_MS,
  SNAPSHOT_RECOVERY_RETRY_MAX_MS,
  isDeltaEvent,
} from "./project-runtime-history.js";

const MAX_ACTIVE_TASK_RECOVERY_CONCURRENCY = 4;

export class ActiveTaskSnapshotRecoveryController<T> {
  readonly #onRecovered: (taskId: string, value: T) => void;
  readonly #pendingTaskIds = new Set<string>();
  readonly #recoverTask: (taskId: string) => Promise<T | undefined>;
  #disposed = false;
  #recoveryAttempt = 0;
  #recoveryRunning = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    recoverTask: (taskId: string) => Promise<T | undefined>,
    onRecovered: (taskId: string, value: T) => void,
  ) {
    this.#recoverTask = recoverTask;
    this.#onRecovered = onRecovered;
  }

  public dispose(): void {
    this.#disposed = true;
    this.#pendingTaskIds.clear();
    this.#clearRetryTimer();
  }

  public forgetTask(taskId: string): void {
    this.#pendingTaskIds.delete(taskId);
    this.#resetWhenComplete();
  }

  public markRecovered(taskId: string): void {
    this.#pendingTaskIds.delete(taskId);
    this.#resetWhenComplete();
  }

  public requestRecovery(taskIds: readonly string[]): void {
    if (this.#disposed) {
      return;
    }
    for (const taskId of taskIds) {
      if (taskId.length > 0) {
        this.#pendingTaskIds.add(taskId);
      }
    }
    if (this.#pendingTaskIds.size > 0 && !this.#recoveryRunning && this.#retryTimer === undefined) {
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
    if (this.#pendingTaskIds.size > 0 || this.#recoveryRunning) {
      return;
    }
    this.#clearRetryTimer();
    this.#recoveryAttempt = 0;
  }

  #scheduleRecoveryRetry(): void {
    if (this.#disposed || this.#pendingTaskIds.size === 0) {
      this.#resetWhenComplete();
      return;
    }
    const retryDelay = Math.min(
      SNAPSHOT_RECOVERY_RETRY_INITIAL_MS * 2 ** this.#recoveryAttempt,
      SNAPSHOT_RECOVERY_RETRY_MAX_MS,
    );
    this.#recoveryAttempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#startRecoveryAttempt();
    }, retryDelay);
  }

  #startRecoveryAttempt(): void {
    if (this.#disposed || this.#recoveryRunning || this.#pendingTaskIds.size === 0) {
      return;
    }
    this.#recoveryRunning = true;
    const taskIds = [...this.#pendingTaskIds];
    let nextTaskIndex = 0;

    const recoverNext = async (): Promise<void> => {
      while (!this.#disposed) {
        const taskId = taskIds[nextTaskIndex];
        nextTaskIndex += 1;
        if (taskId === undefined) {
          return;
        }
        if (!this.#pendingTaskIds.has(taskId)) {
          continue;
        }
        let response: T | undefined;
        try {
          response = await this.#recoverTask(taskId);
        } catch (error) {
          recordInternalWarning("snapshot_recovery_failed", error);
          continue;
        }
        if (response === undefined || !this.#pendingTaskIds.delete(taskId)) {
          continue;
        }
        try {
          // 单个成功结果立即校准 Activity，其他失败 Task 独立留待下一轮重试。
          this.#onRecovered(taskId, response);
        } catch (error) {
          this.#pendingTaskIds.add(taskId);
          recordInternalWarning("snapshot_recovery_failed", error);
        }
      }
    };

    const workerCount = Math.min(MAX_ACTIVE_TASK_RECOVERY_CONCURRENCY, taskIds.length);
    void Promise.all(Array.from({ length: workerCount }, recoverNext)).then(() => {
      this.#recoveryRunning = false;
      if (this.#disposed) {
        return;
      }
      if (this.#pendingTaskIds.size === 0) {
        this.#recoveryAttempt = 0;
        return;
      }
      this.#scheduleRecoveryRetry();
    });
  }
}

export class SnapshotRecoveryController<T> {
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
  ) {
    this.#recoverSnapshot = recoverSnapshot;
    this.#onRecovered = onRecovered;
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
    const retryDelay = Math.min(
      SNAPSHOT_RECOVERY_RETRY_INITIAL_MS * 2 ** this.#recoveryAttempt,
      SNAPSHOT_RECOVERY_RETRY_MAX_MS,
    );
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
      recordInternalWarning("snapshot_recovery_failed", error);
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
        recordInternalWarning("snapshot_recovery_failed", error);
        if (
          this.#recoveryState === "recovering" &&
          recoveryGeneration === this.#recoveryGeneration
        ) {
          this.#scheduleRecoveryRetry();
        }
      });
  }
}

export class TaskEventTarget {
  readonly #buffer = new AgentEventBuffer();
  readonly #onRecoveredSnapshot: (
    response: AgentTaskSnapshotResponse,
    target: TaskEventTarget,
  ) => void;
  readonly #recoverSnapshots = new Set<RecoverTaskSnapshot>();
  readonly #recovery: SnapshotRecoveryController<AgentTaskSnapshotResponse>;
  readonly #store: TaskStore;
  #frameId: number | undefined;

  public constructor(
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
    onRecoveredSnapshot: (response: AgentTaskSnapshotResponse, target: TaskEventTarget) => void,
  ) {
    this.#store = store;
    this.#recoverSnapshots.add(recoverSnapshot);
    this.#onRecoveredSnapshot = onRecoveredSnapshot;
    this.#recovery = new SnapshotRecoveryController(
      async () => this.#recoverSnapshots.values().next().value?.(),
      (response) => {
        this.#onRecoveredSnapshot(response, this);
      },
      () => {
        this.#store.getState().setConnectionState("reconnecting");
      },
    );
  }

  public get sessionId(): string | undefined {
    return this.#store.getState().checkpoint?.sessionId;
  }

  public get taskId(): string {
    return this.#store.getState().taskId;
  }

  public addConsumer(recoverSnapshot: RecoverTaskSnapshot): void {
    this.#recoverSnapshots.add(recoverSnapshot);
  }

  public removeConsumer(recoverSnapshot: RecoverTaskSnapshot): number {
    this.#recoverSnapshots.delete(recoverSnapshot);
    return this.#recoverSnapshots.size;
  }

  public resetForSnapshot(): void {
    // 新 Snapshot 是当前 Store 的权威基线，清除旧帧并允许后续事件重新进入增量路径。
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
    this.#recovery.reset();
  }

  public apply(event: AgentEvent): void {
    if (!this.#recovery.isReady) {
      return;
    }
    if (isDeltaEvent(event)) {
      if (this.#frameId === undefined) {
        // 当前帧的首个 Delta 立即进入 Store，避免再叠加一帧首字延迟。
        this.#frameId = requestAnimationFrame(() => {
          this.#frameId = undefined;
          const pendingEvents = this.#buffer.drain();
          if (pendingEvents.length > 0) {
            this.#store.getState().applyEvents(pendingEvents);
          }
        });
        this.#store.getState().applyEvents([event]);
        return;
      }
      if (!this.#buffer.push(event)) {
        this.requestRecovery();
        return;
      }
      return;
    }
    this.#flushThrough(event.sequence);
    this.#store.getState().applyEvents([event]);
  }

  public dispose(): void {
    this.#recovery.dispose();
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
  }

  public requestRecovery(): void {
    if (!this.#recovery.isReady) {
      return;
    }
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
    this.#recovery.requestRecovery();
  }

  public setConnectionState(state: AgentEventConnectionState): void {
    // Socket 连通不代表 Snapshot 已校准，恢复状态优先于底层传输状态。
    const visibleState = state === "connected" && !this.#recovery.isReady ? "reconnecting" : state;
    this.#store.getState().setConnectionState(visibleState);
    if (visibleState === "connected") {
      this.#store.getState().setError(null);
    }
  }

  #flushThrough(sequence: number): void {
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#store.getState().applyEvents(this.#buffer.flushThrough(sequence));
  }
}
