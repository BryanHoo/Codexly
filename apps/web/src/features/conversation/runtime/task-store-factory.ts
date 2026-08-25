import type { AgentEvent } from "@codexly/protocol";
import { createStore } from "zustand/vanilla";

import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
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
import { reconcileSnapshot, reconstructSnapshot } from "./task-store-snapshot.js";

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
          retainedBytes: 0,
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
          const retainedEntityBytesBefore = measureEventEntityBytes(previousState, event);
          const retainedItemBytesBefore = measureEventItemBytes(previousState, event);
          nextState = {
            ...nextState,
            ...applyAcceptedEvent(nextState, event, changedItemStores),
          };
          const touchedCommandOutputItemIds = getTouchedCommandOutputItemKeys(
            previousState,
            nextState,
            event,
          );
          let retainedBytesDeltaByItemKey: ReadonlyMap<string, number> = new Map();
          if (touchedCommandOutputItemIds !== undefined) {
            const commandOutputUpdate = updateCommandOutputBudget({
              previousBudget: previousState,
              changedItemStores,
              sourceItemStoresByKey: nextState.itemStoresByKey,
              touchedItemKeys: touchedCommandOutputItemIds,
            });
            ({ retainedBytesDeltaByItemKey } = commandOutputUpdate);
            nextState = {
              ...nextState,
              ...commandOutputUpdate.budget,
            };
          }
          const trackedItemKeys = new Set([
            ...retainedItemBytesBefore.keys(),
            ...getEventItemKeys(nextState, event),
          ]);
          const retainedItemBytesDelta =
            measureItemBytesByKeys(nextState, trackedItemKeys) -
            sumRetainedItemBytes(retainedItemBytesBefore);
          const untrackedEvictionDelta = [...retainedBytesDeltaByItemKey].reduce(
            (total, [itemKey, delta]) => total + (trackedItemKeys.has(itemKey) ? 0 : delta),
            0,
          );
          nextState = {
            ...nextState,
            retainedBytes:
              nextState.retainedBytes +
              measureEventEntityBytes(nextState, event) -
              retainedEntityBytesBefore +
              retainedItemBytesDelta +
              untrackedEvictionDelta,
          };
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
      const changedItemStores = new Set<TaskItemStore>();
      set((state) => prependNormalizedHistory(state, response, changedItemStores));
      for (const itemStore of changedItemStores) {
        itemStore.publish();
      }
    },
    reconcile(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set((state) => {
        const checkpoint = state.checkpoint;
        if (
          checkpoint !== null &&
          checkpoint.sessionId === response.checkpoint.sessionId &&
          checkpoint.sequence > response.checkpoint.sequence
        ) {
          // 同一事件会话内禁止旧 Snapshot 回滚 Store，否则历史回放会重复追加 Delta。
          return state;
        }
        return {
          ...normalizeSnapshot(reconcileSnapshot(state, response)),
          // 即使 Task 元数据未变，缺失或新增 Turn 也必须通知快照消费者重新读取 Store。
          itemStructureRevision: state.itemStructureRevision + 1,
          connectionState: "connecting",
          error: null,
        };
      });
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
    setTaskSettings(settings) {
      set((state) =>
        state.snapshotMetadata === null
          ? state
          : {
              snapshotMetadata: { ...state.snapshotMetadata, settings },
            },
      );
    },
    taskId: identity.taskId,
  }));
}

function prependNormalizedHistory(
  state: TaskStoreState,
  response: TaskStoreHydrationResponse,
  changedItemStores: Set<TaskItemStore>,
): TaskStoreState {
  const history = normalizeSnapshot(response);
  const addedTurnIds = history.turnIds.filter((turnId) => state.turnsById[turnId] === undefined);
  const addedItemKeys = new Set(
    addedTurnIds.flatMap((turnId) => history.itemKeysByTurnId[turnId] ?? []),
  );
  const itemStoresByKey = new Map(state.itemStoresByKey);
  for (const itemKey of addedItemKeys) {
    const itemStore = history.itemStoresByKey.get(itemKey);
    if (itemStore !== undefined) {
      itemStoresByKey.set(itemKey, itemStore);
    }
  }
  const itemKeysByTurnId = { ...state.itemKeysByTurnId };
  const turnsById = { ...state.turnsById };
  for (const turnId of addedTurnIds) {
    itemKeysByTurnId[turnId] = history.itemKeysByTurnId[turnId] ?? [];
    const turn = history.turnsById[turnId];
    if (turn !== undefined) {
      turnsById[turnId] = turn;
    }
  }
  const { budget: commandOutputBudget, retainedBytesDeltaByItemKey } = updateCommandOutputBudget({
    previousBudget: {
      commandOutputAccessByItemKey: new Map<string, number>(),
      commandOutputAccessSequence: 0,
      commandOutputBytes: 0,
      commandOutputBytesByItemKey: new Map<string, number>(),
    },
    changedItemStores,
    sourceItemStoresByKey: itemStoresByKey,
    // 旧页先进入访问索引，当前时间线随后进入，确保超限时优先淘汰历史输出。
    touchedItemKeys: [...addedItemKeys, ...state.itemStoresByKey.keys()],
  });
  let retainedBytes =
    state.retainedBytes -
    estimateRetainedBytes(state.turnsNextCursor) +
    estimateRetainedBytes(response.snapshot.turnsNextCursor);
  for (const turnId of addedTurnIds) {
    retainedBytes += estimateRetainedBytes(turnsById[turnId]);
    for (const itemKey of itemKeysByTurnId[turnId] ?? []) {
      retainedBytes += itemStoresByKey.get(itemKey)?.getRetainedBytes() ?? 0;
    }
  }
  for (const [itemKey, delta] of retainedBytesDeltaByItemKey) {
    if (!addedItemKeys.has(itemKey)) {
      retainedBytes += delta;
    }
  }
  // 历史页只增加新实体，既有流式 Item 保持原 Store 和延迟物化状态。
  return {
    ...state,
    ...commandOutputBudget,
    checkpoint: state.checkpoint ?? response.checkpoint,
    itemKeysByTurnId,
    itemStoresByKey,
    itemStructureRevision: state.itemStructureRevision + 1,
    retainedBytes,
    turnIds: [...addedTurnIds, ...state.turnIds],
    turnsNextCursor: response.snapshot.turnsNextCursor,
    turnsById,
  };
}

function measureEventEntityBytes(state: TaskStoreState, event: AgentEvent): number {
  let retainedBytes = 0;
  if (
    event.type === "turn.started" ||
    event.type === "turn.completed" ||
    event.type === "provider.error"
  ) {
    retainedBytes += estimateRetainedBytes(state.turnsById[event.turnId]);
  }
  if (event.type === "task.notice" || event.type === "turn.completed") {
    retainedBytes += state.notices.reduce(
      (total, notice) => total + estimateRetainedBytes(notice),
      0,
    );
  }
  if (
    event.type === "goal.updated" ||
    event.type === "goal.cleared" ||
    event.type === "plan.updated" ||
    event.type === "provider.error" ||
    event.type === "task.status_updated" ||
    event.type === "turn.started" ||
    event.type === "turn.completed" ||
    event.type === "usage.updated"
  ) {
    retainedBytes += estimateRetainedBytes(state.snapshotMetadata);
  }
  if (
    event.type === "pending_request.created" ||
    event.type === "pending_request.resolved" ||
    event.type === "pending_request.expired"
  ) {
    for (const requestId of state.pendingRequestIds) {
      retainedBytes += estimateRetainedBytes(state.pendingRequestsById[requestId]);
    }
  }
  return retainedBytes;
}

function getEventItemKeys(state: TaskStoreState, event: AgentEvent): readonly string[] {
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return state.itemKeysByTurnId[event.turnId] ?? [];
  }
  if (!("itemId" in event) || !("turnId" in event)) {
    return [];
  }
  const itemKeys = [createTaskItemKey(event.turnId, event.itemId)];
  if (event.type === "item.started" || event.type === "item.completed") {
    const currentItemKeys = state.itemKeysByTurnId[event.turnId] ?? [];
    const previousItemKey = currentItemKeys.at(-1);
    if (previousItemKey !== undefined) {
      itemKeys.push(previousItemKey);
    }
    itemKeys.push(createTaskItemKey(event.turnId, `submitted-user-${event.turnId}`));
  }
  return itemKeys;
}

function measureEventItemBytes(state: TaskStoreState, event: AgentEvent): Map<string, number> {
  return new Map(
    getEventItemKeys(state, event).map((itemKey) => [
      itemKey,
      state.itemStoresByKey.get(itemKey)?.getRetainedBytes() ?? 0,
    ]),
  );
}

function measureItemBytesByKeys(state: TaskStoreState, itemKeys: ReadonlySet<string>): number {
  let retainedBytes = 0;
  for (const itemKey of itemKeys) {
    retainedBytes += state.itemStoresByKey.get(itemKey)?.getRetainedBytes() ?? 0;
  }
  return retainedBytes;
}

function sumRetainedItemBytes(retainedBytesByItemKey: ReadonlyMap<string, number>): number {
  let retainedBytes = 0;
  for (const itemBytes of retainedBytesByItemKey.values()) {
    retainedBytes += itemBytes;
  }
  return retainedBytes;
}
