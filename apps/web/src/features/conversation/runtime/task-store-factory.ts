import { createStore } from "zustand/vanilla";

import {
  normalizeSnapshot,
  createTaskItemKey,
  updateCommandOutputBudget,
  type TaskItemStore,
  type TaskStore,
  type TaskStoreHydrationResponse,
  type TaskStoreIdentity,
  type TaskStoreState,
} from "./task-store-core.js";

import { applyAcceptedEvent, getTouchedCommandOutputItemKeys } from "./task-store-events.js";
import {
  mergeOlderHistoryPage,
  reconcileSnapshot,
  reconstructSnapshot,
} from "./task-store-snapshot.js";

export function createTaskStore(
  identity: TaskStoreIdentity,
  initialResponse?: TaskStoreHydrationResponse,
): TaskStore {
  const initialData =
    initialResponse === undefined
      ? {
          checkpoint: null,
          commandOutputAccessByItemKey: new Map<string, number>(),
          commandOutputAccessSequence: 0,
          commandOutputBytesByItemKey: new Map<string, number>(),
          commandOutputBytes: 0,
          itemKeysByTurnId: {},
          itemStoresByKey: new Map<string, TaskItemStore>(),
          itemStructureRevision: 0,
          notices: [],
          pendingRequestIds: [],
          pendingRequestsById: {},
          snapshotMetadata: null,
          turnIds: [],
          turnsNextCursor: null,
          turnsById: {},
        }
      : normalizeSnapshot(initialResponse);

  if (
    initialResponse !== undefined &&
    (initialResponse.snapshot.projectId !== identity.projectId ||
      initialResponse.snapshot.id !== identity.taskId)
  ) {
    throw new Error("Task store identity does not match the initial snapshot");
  }

  return createStore<TaskStoreState>()((set, get) => ({
    ...initialData,
    applyEvents(events) {
      if (events.length === 0) {
        return;
      }
      const changedItemStores = new Set<TaskItemStore>();
      set((currentState) => {
        let nextState = currentState;
        for (const event of events) {
          const checkpoint = nextState.checkpoint;
          const hasValidSequence =
            checkpoint !== null &&
            event.sessionId === checkpoint.sessionId &&
            event.sequence > checkpoint.sequence;
          // Task、Session 与 Sequence 共同约束事件身份和顺序。
          if (event.taskId !== nextState.taskId || !hasValidSequence) {
            continue;
          }
          const previousState = nextState;
          nextState = {
            ...nextState,
            ...applyAcceptedEvent(nextState, event, changedItemStores),
          };
          const touchedCommandOutputItemIds = getTouchedCommandOutputItemKeys(
            previousState,
            nextState,
            event,
          );
          if (touchedCommandOutputItemIds !== undefined) {
            nextState = {
              ...nextState,
              ...updateCommandOutputBudget({
                previousBudget: previousState,
                changedItemStores,
                sourceItemStoresByKey: nextState.itemStoresByKey,
                touchedItemKeys: touchedCommandOutputItemIds,
              }),
            };
          }
        }
        return nextState;
      });
      // 同一动画帧内的多个 Delta 合并为一次目标 Item 通知，避免重复渲染。
      for (const itemStore of changedItemStores) {
        itemStore.publish();
      }
    },
    connectionState: "connecting",
    error: null,
    hydrate(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set((state) => ({
        ...normalizeSnapshot(response),
        // Snapshot 替换会重建 Turn 与 Item 容器，必须推进修订号以失效兼容快照 memo。
        itemStructureRevision: state.itemStructureRevision + 1,
        connectionState: "connecting",
        error: null,
      }));
    },
    projectId: identity.projectId,
    prependHistory(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the history page");
      }
      set((state) => ({
        ...state,
        ...normalizeSnapshot(mergeOlderHistoryPage(state, response)),
        checkpoint: state.checkpoint ?? response.checkpoint,
        itemStructureRevision: state.itemStructureRevision + 1,
        notices: state.notices,
      }));
    },
    reconcile(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set((state) => ({
        ...normalizeSnapshot(reconcileSnapshot(state, response)),
        // 即使 Task 元数据未变，缺失或新增 Turn 也必须通知快照消费者重新读取 Store。
        itemStructureRevision: state.itemStructureRevision + 1,
        connectionState: "connecting",
        error: null,
      }));
    },
    getItem: (itemId, turnId) =>
      get().itemStoresByKey.get(createTaskItemKey(turnId, itemId))?.read(),
    getItemByKey: (itemKey) => get().itemStoresByKey.get(itemKey)?.read(),
    reconstructSnapshot: () => reconstructSnapshot(get()),
    setConnectionState(connectionState) {
      set({ connectionState });
    },
    setError(error) {
      set({ error });
    },
    taskId: identity.taskId,
  }));
}
