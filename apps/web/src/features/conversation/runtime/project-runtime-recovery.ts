import { scheduleEventFlush } from "@codexly/frontend-core/event-flush-scheduler";
import type { AgentEventConnectionState } from "@codexly/client";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import { AgentEventBuffer } from "./task-runtime.js";
import type { TaskStore } from "./task-store.js";

import { SnapshotRecoveryController } from "@codexly/frontend-core/task-snapshot-recovery";
import type { RecoverTaskSnapshot } from "./project-runtime-history.js";
import { isDeltaEvent } from "./project-runtime-history.js";

export class TaskEventTarget {
  readonly #buffer = new AgentEventBuffer();
  readonly #onRecoveredSnapshot: (
    response: AgentTaskSnapshotResponse,
    target: TaskEventTarget,
  ) => void;
  readonly #recoverSnapshots = new Set<RecoverTaskSnapshot>();
  readonly #recovery: SnapshotRecoveryController<AgentTaskSnapshotResponse>;
  readonly #store: TaskStore;
  #cancelFlush: (() => void) | undefined;

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
      (error) => {
        recordInternalWarning("snapshot_recovery_failed", error);
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
    this.#clearScheduledFlush();
    this.#buffer.drain();
    this.#recovery.reset();
  }

  public apply(event: AgentEvent): void {
    if (!this.#recovery.isReady) {
      return;
    }
    if (isDeltaEvent(event)) {
      if (this.#cancelFlush === undefined) {
        // 当前帧的首个 Delta 立即进入 Store，避免再叠加一帧首字延迟。
        this.#cancelFlush = scheduleEventFlush(() => {
          this.#cancelFlush = undefined;
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
    this.#clearScheduledFlush();
    this.#buffer.drain();
  }

  public requestRecovery(): void {
    if (!this.#recovery.isReady) {
      return;
    }
    this.#clearScheduledFlush();
    this.#buffer.drain();
    this.#recovery.requestRecovery();
  }

  public failConnection(error: Error): void {
    // 终态访问错误优先于快照恢复；重置代次并撤销重试，丢弃迟到响应与缓冲增量。
    this.resetForSnapshot();
    this.#store.getState().setError(error);
    this.#store.getState().setConnectionState("closed");
  }

  public setConnectionState(state: AgentEventConnectionState): void {
    // Socket 连通不代表 Snapshot 已校准，恢复状态优先于底层传输状态。
    const visibleState = state === "connected" && !this.#recovery.isReady ? "reconnecting" : state;
    this.#store.getState().setConnectionState(visibleState);
    if (visibleState === "connected") {
      this.#store.getState().setError(null);
    }
  }

  #clearScheduledFlush(): void {
    this.#cancelFlush?.();
    this.#cancelFlush = undefined;
  }

  #flushThrough(sequence: number): void {
    this.#clearScheduledFlush();
    this.#store.getState().applyEvents(this.#buffer.flushThrough(sequence));
  }
}
