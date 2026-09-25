import type { AgentEventConnectionState } from "@/platform/native-client-types.js";
import type { AgentEvent, AgentTaskSnapshotResponse, EventCheckpoint } from "@/protocol/index.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import {
  getActiveProjectTaskIds,
  hasActiveProjectTask,
  type TaskActivityMap,
} from "./task-activity.js";
import type { TaskStore } from "./task-store.js";
import { NativeCommandError } from "../../../platform/tauri/native-client.js";

import {
  ProjectEventHistory,
  type ProjectEventRuntimeOptions,
  type RecoverTaskSnapshot,
} from "./project-runtime-history.js";

import {
  ActiveTaskSnapshotRecoveryController,
  TaskEventTarget,
} from "./project-runtime-recovery.js";

type ProjectRuntimeCallbacks = Readonly<{
  getTaskActivity: () => TaskActivityMap;
  onActivityEvent: (projectId: string, event: AgentEvent) => void;
  onIdle: (runtime: ProjectEventRuntime) => void;
  onSnapshot: (response: AgentTaskSnapshotResponse) => void;
}>;

export class ProjectEventRuntime {
  readonly #callbacks: ProjectRuntimeCallbacks;
  readonly #client: NativeRuntimeClient;
  readonly #eventHistory: ProjectEventHistory;
  readonly #idleTimeoutMs: number;
  readonly #projectId: string;
  readonly #activeTaskRecovery: ActiveTaskSnapshotRecoveryController<AgentTaskSnapshotResponse>;
  readonly #targets = new Map<TaskStore, TaskEventTarget>();
  readonly #retains = new Map<TaskStore, Promise<void>>();
  readonly #retainRetryTimers = new Map<TaskStore, ReturnType<typeof setTimeout>>();
  #connectionCleanup: (() => void) | undefined;
  #connectionState: AgentEventConnectionState = "closed";
  #disposed = false;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #lastAccessAt = Date.now();
  #latestSequence = 0;
  #sessionId: string | undefined;
  #snapshotRecoveryRequired = false;

  public constructor(
    projectId: string,
    client: NativeRuntimeClient,
    callbacks: ProjectRuntimeCallbacks,
    options: ProjectEventRuntimeOptions,
  ) {
    this.#projectId = projectId;
    this.#client = client;
    this.#callbacks = callbacks;
    this.#idleTimeoutMs = options.idleTimeoutMs;
    this.#eventHistory = new ProjectEventHistory({
      maxBytes: options.maxEventHistoryBytes,
      maxEvents: options.maxEventHistoryEvents,
    });
    this.#activeTaskRecovery = new ActiveTaskSnapshotRecoveryController(
      async (taskId) => this.#client.readTask(this.#projectId, taskId),
      (_taskId, response) => {
        this.#callbacks.onSnapshot(response);
      },
    );
  }

  public attachTaskStore(
    response: AgentTaskSnapshotResponse,
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
  ): () => void {
    this.#assertSnapshotProject(response);
    const storeState = store.getState();
    if (storeState.projectId !== this.#projectId || storeState.taskId !== response.snapshot.id) {
      throw new Error("Task store identity does not match the Project Runtime snapshot");
    }

    this.#touch();
    storeState.reconcile(response);
    let target = this.#targets.get(store);
    if (target === undefined) {
      target = new TaskEventTarget(store, recoverSnapshot, (recoveredResponse, recoveredTarget) => {
        this.#hydrateRecoveredSnapshot(recoveredResponse, store, recoveredTarget);
      });
      this.#targets.set(store, target);
      this.#retainTask(store, target);
    } else {
      target.addConsumer(recoverSnapshot);
    }
    target.resetForSnapshot();
    target.setConnectionState(
      this.#connectionState === "closed" ? "connecting" : this.#connectionState,
    );
    this.observeSnapshot(response);
    this.#replayEvents(response.checkpoint, target);

    let attached = true;
    return () => {
      if (!attached) {
        return;
      }
      attached = false;
      const currentTarget = this.#targets.get(store);
      if (currentTarget !== target || currentTarget.removeConsumer(recoverSnapshot) > 0) {
        return;
      }
      currentTarget.dispose();
      this.#targets.delete(store);
      this.#releaseRetainedTask(store);
      this.#touch();
      this.#reevaluateIdleRelease();
    };
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearIdleTimer();
    this.#activeTaskRecovery.dispose();
    this.#stopConnection();
    for (const [store, target] of this.#targets) {
      target.dispose();
      this.#releaseRetainedTask(store);
    }
    this.#targets.clear();
    this.#clearEventHistory();
  }

  #retainTask(store: TaskStore, target: TaskEventTarget, attempt = 0): void {
    const initialState = store.getState();
    initialState.setWriteAccess("checking");
    const retained = this.#client.retainTaskSubscription(this.#projectId, initialState.taskId)
      .then(() => {
        const state = store.getState();
        if (this.#targets.get(store) !== target || state.writeAccess !== "checking") return;
        state.setWriteAccess("writable");
      }).catch((reason: unknown) => {
        const state = store.getState();
        if (this.#targets.get(store) !== target || state.writeAccess === "external") return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        const external = error instanceof NativeCommandError && error.code === "CODEX_THREAD_BUSY";
        if (external) {
          state.setWriteAccess("external");
        } else {
          recordInternalWarning("task_subscription_retain_failed", error, {
            projectId: this.#projectId, taskId: state.taskId,
          });
          // 有界重查期间保持 checking，不让首次落盘的短暂失败替换已显示的会话。
          if (attempt < 2) {
            this.#retainRetryTimers.set(store, setTimeout(() => {
              this.#retainRetryTimers.delete(store);
              if (this.#targets.get(store) === target && store.getState().writeAccess === "checking") {
                this.#retainTask(store, target, attempt + 1);
              }
            }, 500 * 3 ** attempt));
          } else {
            state.setError(error);
            state.setWriteAccess("unavailable");
          }
        }
      });
    this.#retains.set(store, retained);
  }

  #releaseRetainedTask(store: TaskStore): void {
    clearTimeout(this.#retainRetryTimers.get(store));
    this.#retainRetryTimers.delete(store);
    const retained = this.#retains.get(store);
    this.#retains.delete(store);
    // 等待恢复完成再释放，防止快速切换时先 unsubscribe、后 resume 留下无人持有的线程。
    void retained?.then(() => {
      if (!this.#targets.has(store)) this.#releaseTaskSubscription(store.getState().taskId);
    });
  }

  public forgetTask(taskId: string): void {
    this.#activeTaskRecovery.forgetTask(taskId);
    this.#reevaluateIdleRelease();
  }

  public markAccess(): void {
    this.#touch();
    this.#reevaluateIdleRelease();
  }

  public observeSnapshot(response: AgentTaskSnapshotResponse): void {
    this.#assertSnapshotProject(response);
    this.#activeTaskRecovery.markRecovered(response.snapshot.id);
    this.#snapshotRecoveryRequired = false;
    this.#touch();
    this.#ensureConnection(response.checkpoint);
    for (const target of this.#targets.values()) {
      if (target.sessionId !== response.checkpoint.sessionId) {
        target.requestRecovery();
      } else {
        target.setConnectionState(this.#connectionState);
      }
    }
    this.#reevaluateIdleRelease();
  }

  public reconcileTaskSnapshot(response: AgentTaskSnapshotResponse): void {
    this.#assertSnapshotProject(response);
    const matchingTargets: TaskEventTarget[] = [];
    for (const [store, target] of this.#targets) {
      if (store.getState().taskId !== response.snapshot.id) {
        continue;
      }
      target.reconcileSnapshot(response);
      matchingTargets.push(target);
    }
    this.observeSnapshot(response);
    for (const target of matchingTargets) {
      target.setConnectionState(this.#connectionState);
      this.#replayEvents(response.checkpoint, target);
    }
  }

  #appendEventHistory(event: AgentEvent): void {
    // 有界历史用于补齐 Snapshot 请求期间到达的事件，超出预算后由 Snapshot 恢复兜底。
    this.#eventHistory.append(event);
  }

  #assertSnapshotProject(response: AgentTaskSnapshotResponse): void {
    if (response.snapshot.projectId !== this.#projectId) {
      throw new Error("Snapshot Project does not match the Project Runtime");
    }
  }

  #clearEventHistory(): void {
    this.#eventHistory.reset();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer !== undefined) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }
  }

  #ensureConnection(checkpoint: EventCheckpoint): void {
    if (this.#disposed) {
      return;
    }
    if (this.#connectionCleanup !== undefined && this.#sessionId === checkpoint.sessionId) {
      return;
    }
    this.#stopConnection();
    this.#sessionId = checkpoint.sessionId;
    this.#latestSequence = checkpoint.sequence;
    this.#eventHistory.reset(checkpoint.sequence);

    // 连接只在 Project Runtime 创建一次，Sidebar 与所有 Task Store 消费同一事件源。
    let invalidatedDuringSubscription = false;
    const cleanup = this.#client.subscribeEvents({
      afterSequence: checkpoint.sequence,
      onConnectionState: (state) => {
        this.#connectionState = state;
        if (state === "reconnecting") {
          this.#snapshotRecoveryRequired = true;
        }
        const visibleState =
          state === "closed" && this.#snapshotRecoveryRequired ? "reconnecting" : state;
        for (const target of this.#targets.values()) {
          target.setConnectionState(visibleState);
        }
        if (state === "reconnecting") {
          this.#requestSnapshotRecovery();
        }
      },
      onError: (error) => {
        recordInternalWarning("event_connection_failed", error, { projectId: this.#projectId });
      },
      onEvent: (event) => {
        this.#latestSequence = event.sequence;
        this.#appendEventHistory(event);
        this.#callbacks.onActivityEvent(this.#projectId, event);
        // 先更新轻量 Activity，再只向同 taskId 的详细 Store 分发，避免重复解析和跨 Task 缓冲。
        for (const [store, target] of this.#targets) {
          if (store.getState().taskId === event.taskId) {
            target.apply(event);
          }
        }
        this.#reevaluateIdleRelease();
      },
      onResyncRequired: () => {
        invalidatedDuringSubscription = true;
        this.#snapshotRecoveryRequired = true;
        this.#stopConnection();
        this.#connectionState = "reconnecting";
        for (const target of this.#targets.values()) {
          target.setConnectionState("reconnecting");
        }
        this.#requestSnapshotRecovery();
      },
      projectId: this.#projectId,
      sessionId: checkpoint.sessionId,
    });
    // 缓存回放可同步报告缺口，返回的失效订阅不能阻止权威快照建立下一条连接。
    if (invalidatedDuringSubscription) {
      cleanup();
    } else {
      this.#connectionCleanup = cleanup;
    }
  }

  #releaseTaskSubscription(taskId: string): void {
    void this.#client
      .releaseTaskSubscription(this.#projectId, taskId)
      .catch((error: unknown) => {
        recordInternalWarning("task_subscription_release_failed", error, {
          projectId: this.#projectId,
          taskId,
        });
      });
  }

  #hydrateRecoveredSnapshot(
    response: AgentTaskSnapshotResponse,
    store: TaskStore,
    target: TaskEventTarget,
  ): void {
    if (this.#targets.get(store) !== target) {
      return;
    }
    this.#assertSnapshotProject(response);
    const storeState = store.getState();
    if (storeState.projectId !== this.#projectId || storeState.taskId !== response.snapshot.id) {
      throw new Error("Task store identity does not match the recovered snapshot");
    }

    target.reconcileSnapshot(response);
    this.#callbacks.onSnapshot(response);
    this.#replayEvents(response.checkpoint, target);
  }

  #reevaluateIdleRelease(): void {
    this.#clearIdleTimer();
    if (
      this.#disposed ||
      this.#connectionCleanup === undefined ||
      this.#targets.size > 0 ||
      hasActiveProjectTask(this.#callbacks.getTaskActivity(), this.#projectId)
    ) {
      return;
    }
    // 只有无详细消费者、无运行 Task、无待审批且超过空闲期时才释放 Project 连接。
    const remainingIdleMs = this.#idleTimeoutMs - (Date.now() - this.#lastAccessAt);
    if (remainingIdleMs <= 0) {
      this.dispose();
      this.#callbacks.onIdle(this);
      return;
    }
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      this.#reevaluateIdleRelease();
    }, remainingIdleMs);
  }

  #replayEvents(checkpoint: EventCheckpoint, target: TaskEventTarget): void {
    if (checkpoint.sessionId !== this.#sessionId) {
      target.requestRecovery();
      return;
    }
    if (
      checkpoint.sequence < this.#eventHistory.floorSequence &&
      checkpoint.sequence < this.#latestSequence
    ) {
      // Snapshot checkpoint 早于客户端保留窗口时禁止猜测缺失事件，直接请求权威快照。
      target.requestRecovery();
      return;
    }
    this.#eventHistory.forEachAfter(checkpoint.sequence, (event) => {
      if (event.taskId === target.taskId) {
        target.apply(event);
      }
    });
  }

  #requestSnapshotRecovery(): void {
    const visibleTaskIds = new Set<string>();
    for (const target of this.#targets.values()) {
      visibleTaskIds.add(target.taskId);
      target.requestRecovery();
    }
    const backgroundTaskIds = getActiveProjectTaskIds(
      this.#callbacks.getTaskActivity(),
      this.#projectId,
    ).filter((taskId) => !visibleTaskIds.has(taskId));
    // 无可见 Store 时仍校准全部活动 Task，避免遗漏的终态让 Sidebar 长期停留在运行态。
    this.#activeTaskRecovery.requestRecovery(backgroundTaskIds);
  }

  #stopConnection(): void {
    const cleanup = this.#connectionCleanup;
    this.#connectionCleanup = undefined;
    try {
      cleanup?.();
    } catch (error) {
      recordInternalWarning("event_connection_cleanup_failed", error, {
        projectId: this.#projectId,
      });
    }
    this.#connectionState = "closed";
  }

  #touch(): void {
    this.#lastAccessAt = Date.now();
    this.#clearIdleTimer();
  }
}
