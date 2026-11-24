import type { AgentEvent, AgentTurn, EventCheckpoint } from "@codexly/protocol";

import { estimateRetainedBytes } from "./byte-lru.js";
import {
  createInterruptedReplyRecovery,
  type InterruptedReplyStorage,
} from "./interrupted-replies.js";
import { findMessageAliasKeys } from "./message-identity.js";
import type {
  TaskEventItem,
  TaskEventNotice,
  TaskEventRequest,
  TaskEventState,
} from "./task-event-model.js";
import { prependTaskHistoryPage } from "./task-history-page.js";
import { reconcileSnapshot, reconstructSnapshot } from "./task-snapshot.js";
import {
  acceptTaskEvent,
  createTaskItemKey,
  touchedCommandOutputItemKeys,
  type TaskStoreIdentity,
} from "./task-state.js";

type ConnectionState = "closed" | "connected" | "connecting" | "reconnecting";
type StoreItem = TaskEventItem & { text?: string; phase?: string };
interface StoreMetadata {
  id: string;
  projectId: string;
  runtime?: string;
}
type StoreEventType = AgentEvent["type"] | "message.skills_updated";

interface StoreItemHandle<Item> {
  read(): Item;
  peek(): Item;
  publish(): void;
  getRetainedBytes(): number;
}

type StoreEvent<Item> = {
  taskId: string;
  sessionId: string;
  sequence: number;
  turnId?: string;
  itemId?: string;
} & (
  | {
      type: "item.started" | "item.completed";
      turnId: string;
      itemId: string;
      payload: { item: Item };
    }
  | {
      type: "turn.completed";
      turnId: string;
      provider: string;
      payload: { turn: AgentTurnWithoutItems & { items: Item[] } };
    }
  | { type: "turn.started" | "provider.error"; turnId: string }
  | {
      type: Exclude<
        StoreEventType,
        "item.started" | "item.completed" | "turn.completed" | "turn.started" | "provider.error"
      >;
    }
);

type AgentTurnWithoutItems = Omit<AgentTurn, "items">;

type StoreSnapshot<Item, Request, Metadata> = Metadata & {
  pendingRequests: readonly Request[];
  turns: (AgentTurnWithoutItems & { items: Item[] })[];
  turnsNextCursor: string | null;
};

type HydrationResponse<Item, Request, Metadata> = Readonly<{
  checkpoint: EventCheckpoint;
  snapshot: StoreSnapshot<Item, Request, Metadata>;
}>;

interface CommandOutputBudget {
  commandOutputAccessByItemKey: Map<string, number>;
  commandOutputAccessSequence: number;
  commandOutputBytes: number;
  commandOutputBytesByItemKey: Map<string, number>;
}

interface TaskStoreData<ItemStore, Request, Metadata>
  extends TaskEventState<Request, Metadata, ItemStore>, CommandOutputBudget {
  retainedBytes: number;
  turnsNextCursor: string | null;
}

/** Web 和桌面共用同一份生命周期契约，平台只装配具体的实体与 Zustand Store。 */
export interface TaskStoreRuntimeState<Item, ItemStore, Request, Metadata, Settings, Event>
  extends TaskStoreData<ItemStore, Request, Metadata>, TaskStoreIdentity {
  applyEvents: (events: readonly Event[]) => void;
  connectionState: ConnectionState;
  error: Error | null;
  getItem: (itemId: string, turnId: string) => Item | undefined;
  getItemByKey: (itemKey: string) => Item | undefined;
  hydrate: (response: HydrationResponse<Item, Request, Metadata>) => void;
  prependHistory: (response: HydrationResponse<Item, Request, Metadata>) => void;
  reconcile: (response: HydrationResponse<Item, Request, Metadata>) => void;
  reconstructSnapshot: () => StoreSnapshot<Item, Request, Metadata> | undefined;
  setConnectionState: (state: ConnectionState) => void;
  setError: (error: Error | null) => void;
  setTaskSettings: (settings: Settings) => void;
}

type UpdateStore<State> = (update: (state: State) => Partial<State>) => void;

type CommandOutputBudgetUpdater<ItemStore> = (input: {
  previousBudget: CommandOutputBudget;
  changedItemStores: Set<ItemStore>;
  sourceItemStoresByKey: ReadonlyMap<string, ItemStore>;
  touchedItemKeys: readonly string[];
}) => { budget: CommandOutputBudget; retainedBytesDeltaByItemKey: ReadonlyMap<string, number> };

export function createTaskStoreRuntime<
  Item extends StoreItem,
  ItemStore extends StoreItemHandle<Item>,
  Request extends TaskEventRequest,
  Metadata extends StoreMetadata,
  Settings,
  Event extends StoreEvent<Item>,
>(
  options: {
    identity: TaskStoreIdentity;
    initialResponse: HydrationResponse<Item, Request, Metadata> | undefined;
    replyStorage: InterruptedReplyStorage | undefined;
    normalizeSnapshot: (
      response: HydrationResponse<Item, Request, Metadata>,
    ) => TaskStoreData<ItemStore, Request, Metadata>;
    applyAcceptedEvent: (
      state: TaskEventState<Request, Metadata, ItemStore>,
      event: Event,
      changedItemStores: Set<ItemStore>,
    ) => Partial<TaskEventState<Request, Metadata, ItemStore>>;
    updateCommandOutputBudget: CommandOutputBudgetUpdater<ItemStore>;
    isPersistentNotice: (notice: TaskEventNotice) => boolean;
  },
  set: UpdateStore<TaskStoreRuntimeState<Item, ItemStore, Request, Metadata, Settings, Event>>,
  get: () => TaskStoreRuntimeState<Item, ItemStore, Request, Metadata, Settings, Event>,
): TaskStoreRuntimeState<Item, ItemStore, Request, Metadata, Settings, Event> {
  type State = TaskStoreRuntimeState<Item, ItemStore, Request, Metadata, Settings, Event>;
  type Response = HydrationResponse<Item, Request, Metadata>;
  const {
    identity,
    initialResponse,
    replyStorage,
    normalizeSnapshot,
    applyAcceptedEvent,
    updateCommandOutputBudget,
    isPersistentNotice,
  } = options;
  function validateIdentity(
    response: Response,
    source: "initial snapshot" | "snapshot" | "history page",
  ): void {
    if (
      response.snapshot.projectId !== identity.projectId ||
      response.snapshot.id !== identity.taskId
    ) {
      throw new Error(`Task store identity does not match the ${source}`);
    }
  }
  if (initialResponse !== undefined) validateIdentity(initialResponse, "initial snapshot");

  const replyRecovery = createInterruptedReplyRecovery(identity, replyStorage);
  const restoreReplies = (response: Response): Response => ({
    ...response,
    snapshot: { ...response.snapshot, turns: replyRecovery.restore(response.snapshot.turns) },
  });

  function replaceSnapshot(state: State, response: Response, reconcile: boolean): Partial<State> {
    const restored = restoreReplies(response);
    const normalized = normalizeSnapshot(reconcile ? reconcileSnapshot(state, restored) : restored);
    // 快照不携带通知。同一会话只继承平台认定需要持续展示的通知。
    const notices =
      state.checkpoint?.sessionId === response.checkpoint.sessionId
        ? state.notices.filter(isPersistentNotice)
        : [];
    return {
      ...normalized,
      notices,
      retainedBytes: normalized.retainedBytes + estimateNoticeBytes(notices),
      // 新快照会重建 Turn 与 Item 容器，递增结构修订号以失效兼容快照缓存。
      itemStructureRevision: state.itemStructureRevision + 1,
      connectionState: "connecting",
      error: null,
    };
  }
  const initialData: TaskStoreData<ItemStore, Request, Metadata> =
    initialResponse === undefined
      ? {
          checkpoint: null,
          commandOutputAccessByItemKey: new Map<string, number>(),
          commandOutputAccessSequence: 0,
          commandOutputBytesByItemKey: new Map<string, number>(),
          commandOutputBytes: 0,
          itemKeysByTurnId: {},
          itemStoresByKey: new Map<string, ItemStore>(),
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
      : normalizeSnapshot(restoreReplies(initialResponse));

  return {
    ...initialData,
    applyEvents(events) {
      if (events.length === 0) {
        return;
      }
      const changedItemStores = new Set<ItemStore>();
      set((currentState) => {
        let nextState = currentState;
        for (const incomingEvent of events) {
          let event = incomingEvent;
          // Task、Session 与 Sequence 共同约束事件身份和顺序。
          if (!acceptTaskEvent(nextState.taskId, nextState.checkpoint, event)) {
            continue;
          }
          // 中断终态可能省略尚未完成的消息，先保存该回合已经接收的正文。
          if (
            event.type === "turn.completed" &&
            event.provider === "codex" &&
            event.payload.turn.status === "interrupted"
          ) {
            const items = (nextState.itemKeysByTurnId[event.turnId] ?? []).flatMap((key) => {
              const item = nextState.itemStoresByKey.get(key)?.read();
              return item === undefined ? [] : [item];
            });
            replyRecovery.save({ ...event.payload.turn, items });
            const restored = replyRecovery.restore([event.payload.turn])[0];
            if (restored !== undefined) event = { ...event, payload: { turn: restored } };
          }
          const previousState = nextState;
          const retainedEntityBytesBefore = measureEventEntityBytes(previousState, event);
          const trackedItemKeys = new Set(getEventItemKeys(previousState, event));
          const retainedItemBytesBefore = measureItemBytesByKeys(previousState, trackedItemKeys);
          nextState = {
            ...previousState,
            ...applyAcceptedEvent(previousState, event, changedItemStores),
          };
          for (const itemKey of getEventItemKeys(nextState, event)) trackedItemKeys.add(itemKey);
          // 每个事件只统计受影响的实体，预算淘汰的其他条目通过单独的差额计入。
          const touchedCommandOutputs = touchedCommandOutputItemKeys(
            previousState,
            nextState,
            event,
          );
          let untrackedEvictionDelta = 0;
          if (touchedCommandOutputs !== undefined) {
            const { budget, retainedBytesDeltaByItemKey } = updateCommandOutputBudget({
              previousBudget: previousState,
              changedItemStores,
              sourceItemStoresByKey: nextState.itemStoresByKey,
              touchedItemKeys: touchedCommandOutputs,
            });
            Object.assign(nextState, budget);
            for (const [itemKey, delta] of retainedBytesDeltaByItemKey) {
              if (!trackedItemKeys.has(itemKey)) untrackedEvictionDelta += delta;
            }
          }
          nextState.retainedBytes +=
            measureEventEntityBytes(nextState, event) -
            retainedEntityBytesBefore +
            measureItemBytesByKeys(nextState, trackedItemKeys) -
            retainedItemBytesBefore +
            untrackedEvictionDelta;
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
      validateIdentity(response, "snapshot");
      set((state) => replaceSnapshot(state, response, false));
    },
    prependHistory(response) {
      validateIdentity(response, "history page");
      const changedItemStores = new Set<ItemStore>();
      set((state) =>
        prependNormalizedHistory(
          state,
          restoreReplies(response),
          changedItemStores,
          normalizeSnapshot,
          updateCommandOutputBudget,
        ),
      );
      for (const itemStore of changedItemStores) itemStore.publish();
    },
    reconcile(response) {
      validateIdentity(response, "snapshot");
      set((state) => {
        const checkpoint = state.checkpoint;
        // 同一会话拒绝较旧的 checkpoint，避免重放时重复追加 Delta。
        if (
          checkpoint?.sessionId === response.checkpoint.sessionId &&
          checkpoint.sequence > response.checkpoint.sequence
        )
          return state;
        return replaceSnapshot(state, response, true);
      });
    },
    getItem: (itemId, turnId) =>
      get().itemStoresByKey.get(createTaskItemKey(turnId, itemId))?.read(),
    getItemByKey: (itemKey) => get().itemStoresByKey.get(itemKey)?.read(),
    reconstructSnapshot: () => reconstructSnapshot(get()),
    setConnectionState(connectionState) {
      set(() => ({ connectionState }));
    },
    setError(error) {
      set(() => ({ error }));
    },
    setTaskSettings(settings) {
      set((state) =>
        // 旧设置请求可能晚于运行时接管返回，不能重新污染 ACP 元数据。
        state.snapshotMetadata === null || state.snapshotMetadata.runtime === "acp"
          ? state
          : {
              snapshotMetadata: { ...state.snapshotMetadata, settings },
            },
      );
    },
    projectId: identity.projectId,
    taskId: identity.taskId,
  };
}

function prependNormalizedHistory<Item, ItemStore extends StoreItemHandle<Item>, Request, Metadata>(
  state: TaskStoreData<ItemStore, Request, Metadata>,
  response: HydrationResponse<Item, Request, Metadata>,
  changedItemStores: Set<ItemStore>,
  normalizeSnapshot: (
    response: HydrationResponse<Item, Request, Metadata>,
  ) => TaskStoreData<ItemStore, Request, Metadata>,
  updateCommandOutputBudget: CommandOutputBudgetUpdater<ItemStore>,
): TaskStoreData<ItemStore, Request, Metadata> {
  const history = normalizeSnapshot(response);
  const { addedTurnIds, addedItemKeys, itemKeysByTurnId, turnsById } = prependTaskHistoryPage(
    state,
    history,
  );
  const itemStoresByKey = new Map(state.itemStoresByKey);
  for (const itemKey of addedItemKeys) {
    const itemStore = history.itemStoresByKey.get(itemKey);
    if (itemStore !== undefined) {
      itemStoresByKey.set(itemKey, itemStore);
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
  for (const turnId of history.turnIds) {
    retainedBytes +=
      estimateRetainedBytes(turnsById[turnId]) - estimateRetainedBytes(state.turnsById[turnId]);
  }
  for (const itemKey of addedItemKeys) {
    retainedBytes += itemStoresByKey.get(itemKey)?.getRetainedBytes() ?? 0;
  }
  for (const [itemKey, delta] of retainedBytesDeltaByItemKey) {
    if (!addedItemKeys.has(itemKey)) {
      retainedBytes += delta;
    }
  }
  // 旧回合与同一回合的 Item 续页共用索引合并，既有流式 Store 不读取、不替换。
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

function estimateNoticeBytes(notices: readonly TaskEventNotice[]): number {
  return notices.reduce((total, notice) => total + estimateRetainedBytes(notice), 0);
}

function measureEventEntityBytes(
  state: TaskStoreData<unknown, TaskEventRequest, unknown>,
  event: StoreEvent<StoreItem>,
): number {
  let retainedBytes = 0;
  if (
    event.type === "turn.started" ||
    event.type === "turn.completed" ||
    event.type === "provider.error"
  ) {
    retainedBytes += estimateRetainedBytes(state.turnsById[event.turnId]);
  }
  if (event.type === "task.notice" || event.type === "turn.completed") {
    retainedBytes += estimateNoticeBytes(state.notices);
  }
  if (
    event.type === "goal.updated" ||
    event.type === "goal.cleared" ||
    event.type === "plan.updated" ||
    event.type === "provider.error" ||
    event.type === "task.status_updated" ||
    event.type === "task.metadata_changed" ||
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

function getEventItemKeys(
  state: Pick<
    TaskStoreData<StoreItemHandle<StoreItem>, unknown, unknown>,
    "itemKeysByTurnId" | "itemStoresByKey"
  >,
  event: StoreEvent<StoreItem>,
): readonly string[] {
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return state.itemKeysByTurnId[event.turnId] ?? [];
  }
  if (event.itemId === undefined || event.turnId === undefined) {
    return [];
  }
  const itemKeys = [createTaskItemKey(event.turnId, event.itemId)];
  if (event.type === "item.started" || event.type === "item.completed") {
    // 旧别名事件也会删除当前规范实体，内存预算必须同时追踪被接管的键。
    itemKeys.push(...findMessageAliasKeys(state, event.turnId, event.payload.item));
    if (event.payload.item.type === "message") {
      for (const alias of event.payload.item.identityAliases ?? []) {
        itemKeys.push(createTaskItemKey(event.turnId, alias));
      }
    }
    itemKeys.push(createTaskItemKey(event.turnId, `submitted-user-${event.turnId}`));
  }
  return itemKeys;
}

function measureItemBytesByKeys(
  state: {
    itemStoresByKey: ReadonlyMap<string, Pick<StoreItemHandle<unknown>, "getRetainedBytes">>;
  },
  itemKeys: ReadonlySet<string>,
): number {
  let retainedBytes = 0;
  for (const itemKey of itemKeys) {
    retainedBytes += state.itemStoresByKey.get(itemKey)?.getRetainedBytes() ?? 0;
  }
  return retainedBytes;
}
