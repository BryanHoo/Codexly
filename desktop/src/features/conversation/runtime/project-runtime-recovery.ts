import { scheduleEventFlush } from "@codexly/frontend-core/event-flush-scheduler";
import type { AgentEventConnectionState } from "@/platform/native-client-types.js";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import {
  applicationPerformanceMetrics,
  PERFORMANCE_MONITORING_ENABLED,
} from "@/shared/performance/performance-metrics.js";
import {
  getApplicationDetailViewUpdateGate,
  type DetailViewUpdateGate,
} from "../../../shared/lifecycle/application-visibility.js";
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
  readonly #updateGate: DetailViewUpdateGate;
  #cancelFlush: (() => void) | undefined;
  #pendingConnectionState: AgentEventConnectionState | undefined;
  #pendingSnapshot: AgentTaskSnapshotResponse | undefined;
  #suspended: boolean;
  #suspendedBufferOverflowed = false;
  #unsubscribeUpdateGate: () => void = () => undefined;

  public constructor(
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
    onRecoveredSnapshot: (response: AgentTaskSnapshotResponse, target: TaskEventTarget) => void,
    updateGate: DetailViewUpdateGate = getApplicationDetailViewUpdateGate(),
  ) {
    this.#store = store;
    this.#recoverSnapshots.add(recoverSnapshot);
    this.#onRecoveredSnapshot = onRecoveredSnapshot;
    this.#updateGate = updateGate;
    this.#suspended = updateGate.isSuspended();
    this.#recovery = new SnapshotRecoveryController(
      async () => this.#recoverSnapshots.values().next().value?.(),
      (response) => {
        this.#onRecoveredSnapshot(response, this);
      },
      () => {
        this.setConnectionState("reconnecting");
      },
      (error) => {
        recordInternalWarning("snapshot_recovery_failed", error);
      },
    );
    this.#unsubscribeUpdateGate = updateGate.subscribe(() => this.#handleUpdateGateChange());
  }

  public get sessionId(): string | undefined {
    return this.#pendingSnapshot?.checkpoint.sessionId ?? this.#store.getState().checkpoint?.sessionId;
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
    this.#pendingSnapshot = undefined;
    this.#suspendedBufferOverflowed = false;
    this.#recovery.reset();
  }

  public reconcileSnapshot(response: AgentTaskSnapshotResponse): void {
    if (this.#suspended) {
      // 先建立 Snapshot checkpoint 边界，禁止前后 Delta 在后台继续跨基线合并。
      this.#buffer.retainAfter(response.checkpoint.sessionId, response.checkpoint.sequence);
      this.#pendingSnapshot = response;
      return;
    }
    this.#store.getState().reconcile(response);
    this.resetForSnapshot();
  }

  public apply(event: AgentEvent): void {
    if (!this.#recovery.isReady) {
      return;
    }
    if (this.#suspended) {
      if (!this.#suspendedBufferOverflowed && !this.#buffer.push(event)) {
        this.#suspendedBufferOverflowed = true;
      }
      return;
    }
    if (isDeltaEvent(event)) {
      if (PERFORMANCE_MONITORING_ENABLED && event.receivedAtUnixMs !== undefined) {
        // 只记录实际进入可见 Task Store 的 Delta，避免后台任务污染 React commit 延迟。
        applicationPerformanceMetrics.recordDeltaReceived(
          `${event.sessionId}:${event.taskId}:${String(event.sequence)}`,
          event.receivedAtUnixMs,
        );
      }
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
    this.#unsubscribeUpdateGate();
    this.#recovery.dispose();
    this.#clearScheduledFlush();
    this.#buffer.drain();
    this.#pendingConnectionState = undefined;
    this.#pendingSnapshot = undefined;
    this.#suspendedBufferOverflowed = false;
  }

  public requestRecovery(): void {
    if (!this.#recovery.isReady) {
      return;
    }
    this.#clearScheduledFlush();
    this.#buffer.drain();
    this.#pendingSnapshot = undefined;
    this.#suspendedBufferOverflowed = false;
    this.#recovery.requestRecovery();
  }

  public setConnectionState(state: AgentEventConnectionState): void {
    if (this.#suspended) {
      this.#pendingConnectionState = state;
      return;
    }
    this.#applyConnectionState(state);
  }

  #applyConnectionState(state: AgentEventConnectionState): void {
    // Socket 连通不代表 Snapshot 已校准，恢复状态优先于底层传输状态。
    const visibleState = state === "connected" && !this.#recovery.isReady ? "reconnecting" : state;
    this.#store.getState().setConnectionState(visibleState);
    if (visibleState === "connected") {
      this.#store.getState().setError(null);
    }
  }

  #flushThrough(sequence: number): void {
    this.#clearScheduledFlush();
    this.#store.getState().applyEvents(this.#buffer.flushThrough(sequence));
  }

  #clearScheduledFlush(): void {
    this.#cancelFlush?.();
    this.#cancelFlush = undefined;
  }

  #handleUpdateGateChange(): void {
    const suspended = this.#updateGate.isSuspended();
    if (this.#suspended === suspended) return;
    this.#suspended = suspended;
    if (suspended) {
      this.#clearScheduledFlush();
      return;
    }
    if (this.#suspendedBufferOverflowed) {
      this.#pendingSnapshot = undefined;
      this.requestRecovery();
      return;
    }
    let pendingEvents = this.#buffer.drain();
    const pendingSnapshot = this.#pendingSnapshot;
    this.#pendingSnapshot = undefined;
    if (pendingSnapshot !== undefined) {
      this.#store.getState().reconcile(pendingSnapshot);
      this.#recovery.reset();
      pendingEvents = pendingEvents.filter(
        (event) =>
          event.sessionId === pendingSnapshot.checkpoint.sessionId &&
          event.sequence > pendingSnapshot.checkpoint.sequence,
      );
    }
    const pendingConnectionState = this.#pendingConnectionState;
    this.#pendingConnectionState = undefined;
    if (pendingConnectionState !== undefined) {
      this.#applyConnectionState(pendingConnectionState);
    }
    if (pendingEvents.length > 0) {
      // 恢复时只通知一次 Store，避免逐条追赶积压造成前台卡顿。
      this.#store.getState().applyEvents(pendingEvents);
    }
  }
}
