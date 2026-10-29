import type { TaskEventModel } from "@codexly/protocol";
import { applyMessageAliases, resolveMessageAliases } from "./message-identity.js";
import { createTaskItemKey, retainPendingRequest } from "./task-state.js";
import { retainTurnItemTimings, recordToolItemTiming } from "./task-event-timing.js";
import type {
  TaskDeltaEvent,
  TaskEventItem,
  TaskEventItemStore,
  TaskEventMetadata,
  TaskEventNotice,
  TaskEventRequest,
  TaskEventState,
  TaskEventTurn,
  TaskReasoningPayload,
} from "./task-event-model.js";

type FileChangeEvent<Item> = Extract<TaskEventModel<Item>, { type: "file_change.updated" }>;

/** 每个平台只注入实体构造和原生权威策略；事件分派与身份合并保持唯一实现。 */
export function createTaskEventReducer<
  Item extends TaskEventItem,
  Request extends TaskEventRequest,
  Metadata extends TaskEventMetadata,
  Reasoning extends TaskReasoningPayload,
  Store extends TaskEventItemStore<Item, Reasoning>,
>(options: {
  createItemStore(item: Item): Store;
  createDeltaItem(event: TaskDeltaEvent<Reasoning>): Item | undefined;
  createFileChangeItem(event: FileChangeEvent<Item>): Item;
  retainNotice(
    notices: readonly TaskEventNotice[],
    event: TaskEventNotice,
  ): readonly TaskEventNotice[];
  isPersistentNotice(notice: TaskEventNotice): boolean;
  resolveCompletedTurn(
    current: TaskEventTurn | undefined,
    incoming: TaskEventTurn & { items: Item[] },
  ): TaskEventTurn & { items: Item[] };
}) {
  type State = TaskEventState<Request, Metadata, Store>;
  type Event = TaskEventModel<Item, TaskEventTurn, Request, Reasoning>;

  function replaceTurnItems(
    state: State,
    turnId: string,
    items: readonly Item[],
    changedItemStores: Set<Store>,
  ): Pick<State, "itemKeysByTurnId"> {
    const previousItemIds = state.itemKeysByTurnId[turnId] ?? [];
    const nextItemIds = new Set(items.map((item) => createTaskItemKey(turnId, item.id)));
    for (const itemId of previousItemIds) {
      if (!nextItemIds.has(itemId)) {
        state.itemStoresByKey.delete(itemId);
      }
    }
    for (const item of items) {
      const itemKey = createTaskItemKey(turnId, item.id);
      const itemStore = state.itemStoresByKey.get(itemKey);
      if (itemStore === undefined) {
        state.itemStoresByKey.set(itemKey, options.createItemStore(item));
      } else {
        itemStore.replace(item);
        changedItemStores.add(itemStore);
      }
    }
    return {
      itemKeysByTurnId: {
        ...state.itemKeysByTurnId,
        [turnId]: [...nextItemIds],
      },
    };
  }
  function mergeTerminalTurnItems(
    state: State,
    turnId: string,
    terminalItems: readonly Item[],
  ): readonly Item[] {
    const currentItems = (state.itemKeysByTurnId[turnId] ?? []).flatMap((key) => {
      const item = state.itemStoresByKey.get(key)?.read();
      return item === undefined ? [] : [item];
    });
    const normalizedCurrentItems = resolveMessageAliases(currentItems, terminalItems, turnId);
    const currentItemIds = new Set(normalizedCurrentItems.map((item) => item.id));
    const terminalItemsById = new Map(terminalItems.map((item) => [item.id, item]));
    const terminalItemsBeforeCurrentId = new Map<string, Item[]>();
    let pendingTerminalItems: Item[] = [];
    for (const terminalItem of terminalItems) {
      if (!currentItemIds.has(terminalItem.id)) {
        pendingTerminalItems.push(terminalItem);
        continue;
      }
      if (pendingTerminalItems.length > 0) {
        terminalItemsBeforeCurrentId.set(terminalItem.id, pendingTerminalItems);
        pendingTerminalItems = [];
      }
    }

    // 已展示 Item 不移动；终态新增 Item 依照下一个共同实体插入，兼顾两条有序序列。
    return [
      ...normalizedCurrentItems.flatMap((item) => [
        ...(terminalItemsBeforeCurrentId.get(item.id) ?? []),
        terminalItemsById.get(item.id) ?? item,
      ]),
      ...pendingTerminalItems,
    ];
  }

  function applyAcceptedEvent(
    state: State,
    event: Event,
    changedItemStores: Set<Store>,
  ): Partial<State> {
    const snapshotMetadata = state.snapshotMetadata;
    if (snapshotMetadata === null) {
      return {};
    }

    const checkpoint = { sequence: event.sequence, sessionId: event.sessionId };
    switch (event.type) {
      case "project.git_metadata_changed":
        return {};
      case "turn.started": {
        const { items, ...normalizedTurn } = event.payload.turn;
        return {
          checkpoint,
          // 提交响应可能先于空启动事件到达；保留已经可见的实体及订阅身份。
          ...(items.length === 0 && state.turnsById[event.turnId] !== undefined
            ? {}
            : replaceTurnItems(state, event.turnId, items, changedItemStores)),
          snapshotMetadata: {
            ...snapshotMetadata,
            status: "running",
            updatedAt: event.timestamp,
          },
          itemStructureRevision: state.itemStructureRevision + 1,
          turnIds: [...state.turnIds.filter((turnId) => turnId !== event.turnId), event.turnId],
          turnsById: {
            ...state.turnsById,
            [event.turnId]: retainTurnItemTimings(state.turnsById[event.turnId], normalizedTurn),
          },
        };
      }
      case "message.delta":
      case "plan.delta":
      case "reasoning.delta":
      case "command.output_delta": {
        const currentTurn = state.turnsById[event.turnId];
        if (currentTurn === undefined) {
          return {
            checkpoint,
            snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          };
        }
        // 新输出证明可重试故障已经恢复；已失败 Turn 的确认错误继续保留。
        const turnsById =
          currentTurn.status === "running" && currentTurn.error !== null
            ? { ...state.turnsById, [event.turnId]: { ...currentTurn, error: null } }
            : state.turnsById;
        const itemKey = createTaskItemKey(event.turnId, event.itemId);
        const currentItemStore = state.itemStoresByKey.get(itemKey);
        if (currentItemStore !== undefined) {
          if (currentItemStore.appendDelta(event)) {
            changedItemStores.add(currentItemStore);
          }
          return {
            checkpoint,
            snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
            turnsById,
          };
        }
        const createdItem = options.createDeltaItem(event);
        if (createdItem === undefined) {
          return { checkpoint };
        }
        const createdItemStore = options.createItemStore(createdItem);
        createdItemStore.appendDelta(event);
        state.itemStoresByKey.set(itemKey, createdItemStore);
        changedItemStores.add(createdItemStore);
        return {
          checkpoint,
          itemKeysByTurnId: {
            ...state.itemKeysByTurnId,
            [event.turnId]: [...(state.itemKeysByTurnId[event.turnId] ?? []), itemKey],
          },
          itemStructureRevision: state.itemStructureRevision + 1,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          turnsById,
        };
      }
      case "tool.progress": {
        const itemKey = createTaskItemKey(event.turnId, event.itemId);
        const currentItemStore = state.itemStoresByKey.get(itemKey);
        if (currentItemStore === undefined) {
          return {
            checkpoint,
            snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          };
        }
        const currentItem = currentItemStore.read();
        if (currentItem.type !== "tool") {
          return { checkpoint };
        }
        currentItemStore.replace({ ...currentItem, progress: event.payload.message });
        changedItemStores.add(currentItemStore);
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      case "file_change.updated": {
        const itemKey = createTaskItemKey(event.turnId, event.itemId);
        const currentItemStore = state.itemStoresByKey.get(itemKey);
        if (currentItemStore !== undefined) {
          const currentItem = currentItemStore.read();
          if (currentItem.type !== "file_change") {
            return { checkpoint };
          }
          currentItemStore.replace({
            ...currentItem,
            changes: event.payload.changes,
            status: "running",
          });
          changedItemStores.add(currentItemStore);
          return {
            checkpoint,
            snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          };
        }
        if (state.turnsById[event.turnId] === undefined) {
          return { checkpoint };
        }
        const createdItemStore = options.createItemStore(options.createFileChangeItem(event));
        state.itemStoresByKey.set(itemKey, createdItemStore);
        changedItemStores.add(createdItemStore);
        return {
          checkpoint,
          itemKeysByTurnId: {
            ...state.itemKeysByTurnId,
            [event.turnId]: [...(state.itemKeysByTurnId[event.turnId] ?? []), itemKey],
          },
          itemStructureRevision: state.itemStructureRevision + 1,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      case "task.notice": {
        return {
          checkpoint,
          notices: options.retainNotice(state.notices, event),
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      case "mcp_server.status_updated":
        // MCP 清单由独立 Query 持有；Task Store 只推进统一事件 checkpoint。
        return { checkpoint };
      case "goal.updated":
        return {
          checkpoint,
          snapshotMetadata: {
            ...snapshotMetadata,
            goal: event.payload.goal,
            updatedAt: event.timestamp,
          },
        };
      case "goal.cleared":
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, goal: null, updatedAt: event.timestamp },
        };
      case "queue.changed":
        // 队列由独立 Query 持有；通知只负责推进 checkpoint 并触发精确失效。
        return { checkpoint };
      case "task.status_updated":
        return {
          checkpoint,
          snapshotMetadata: {
            ...snapshotMetadata,
            status: event.payload.status,
            updatedAt: event.timestamp,
          },
        };
      case "task.metadata_changed":
        // 标题与权限都是元数据补丁，直接更新展示，不重新水合聊天正文。
        return {
          checkpoint,
          snapshotMetadata: {
            ...snapshotMetadata,
            ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
            ...(event.payload.permissionMode === undefined
              ? {}
              : {
                  threadConfiguration: {
                    model: snapshotMetadata.threadConfiguration?.model ?? null,
                    reasoningEffort: snapshotMetadata.threadConfiguration?.reasoningEffort ?? null,
                    permissionMode: event.payload.permissionMode,
                  },
                }),
          },
        };
      case "skills.changed":
      case "task.removed":
        // Project 级缓存由 Runtime 回调同步，Task Store 只推进 checkpoint。
        return { checkpoint };
      case "item.started":
      case "item.completed": {
        const currentTurn = state.turnsById[event.turnId];
        if (currentTurn === undefined) {
          return {
            checkpoint,
            snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          };
        }
        const itemKey = createTaskItemKey(event.turnId, event.itemId);
        const currentItemStore = state.itemStoresByKey.get(itemKey);
        const currentItemIds = applyMessageAliases(state, event.turnId, event.payload.item);
        const itemAlreadyExists = currentItemIds.includes(itemKey);
        const submittedUserItemId = `submitted-user-${event.turnId}`;
        const submittedUserItemKey = createTaskItemKey(event.turnId, submittedUserItemId);
        const replacesSubmittedUserItem =
          event.payload.item.type === "message" &&
          event.payload.item.role === "user" &&
          currentItemIds.includes(submittedUserItemKey);
        // 相同键的权威替换也可能改变角色、阶段与完成态聚合；只使所属回合失效。
        // 文本 Delta 仍走独立分支，不复制键数组或唤醒历史回合。
        const nextItemIds = replacesSubmittedUserItem
          ? currentItemIds.flatMap((candidateKey) =>
              candidateKey === itemKey
                ? []
                : candidateKey === submittedUserItemKey
                  ? itemKey
                  : candidateKey,
            )
          : itemAlreadyExists
            ? [...currentItemIds]
            : [...currentItemIds, itemKey];
        // 权威用户项原位接管提交占位，不能移动到已经到达的助手回复之后。
        if (replacesSubmittedUserItem) {
          state.itemStoresByKey.delete(submittedUserItemKey);
        }
        if (currentItemStore === undefined) {
          state.itemStoresByKey.set(itemKey, options.createItemStore(event.payload.item));
        } else {
          currentItemStore.replace(event.payload.item);
          changedItemStores.add(currentItemStore);
        }
        const timedTurn = recordToolItemTiming(currentTurn, event);
        return {
          checkpoint,
          itemKeysByTurnId: { ...state.itemKeysByTurnId, [event.turnId]: nextItemIds },
          itemStructureRevision: state.itemStructureRevision + 1,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          ...(timedTurn === currentTurn
            ? {}
            : { turnsById: { ...state.turnsById, [event.turnId]: timedTurn } }),
        };
      }
      case "turn.completed": {
        const currentTurn = state.turnsById[event.turnId];
        const completedTurn = options.resolveCompletedTurn(currentTurn, event.payload.turn);
        const { items: terminalItems, ...normalizedTurn } = completedTurn;
        const items = mergeTerminalTurnItems(state, event.turnId, terminalItems);
        return {
          checkpoint,
          ...(currentTurn === undefined
            ? {}
            : replaceTurnItems(state, event.turnId, items, changedItemStores)),
          // Turn 完成后只保留右栏中的运行时警告。
          notices: state.notices.filter((notice) => options.isPersistentNotice(notice)),
          snapshotMetadata: {
            ...snapshotMetadata,
            status: completedTurn.status === "failed" ? "failed" : "idle",
            updatedAt: event.timestamp,
          },
          itemStructureRevision: state.itemStructureRevision + 1,
          turnsById:
            currentTurn === undefined
              ? state.turnsById
              : {
                  ...state.turnsById,
                  // 终态通知不携带历史过程入口，保留恢复摘要时登记的独立游标。
                  [event.turnId]: retainTurnItemTimings(currentTurn, {
                    ...currentTurn,
                    ...normalizedTurn,
                  }),
                },
        };
      }
      case "plan.updated":
        return {
          checkpoint,
          snapshotMetadata: {
            ...snapshotMetadata,
            plan: event.payload.plan,
            updatedAt: event.timestamp,
          },
        };
      case "usage.updated":
        return {
          checkpoint,
          snapshotMetadata: {
            ...snapshotMetadata,
            contextUsage: event.payload.usage,
            updatedAt: event.timestamp,
          },
        };
      case "provider.error": {
        const currentTurn = state.turnsById[event.turnId];
        const turnsById =
          currentTurn === undefined
            ? state.turnsById
            : {
                ...state.turnsById,
                [event.turnId]: {
                  ...currentTurn,
                  error: event.payload.message,
                  status: event.payload.willRetry ? currentTurn.status : ("failed" as const),
                },
              };
        return {
          checkpoint,
          snapshotMetadata: event.payload.willRetry
            ? snapshotMetadata
            : { ...snapshotMetadata, status: "failed", updatedAt: event.timestamp },
          turnsById,
        };
      }
      case "pending_request.created":
      case "pending_request.resolved":
      case "pending_request.expired": {
        const request = event.payload.request;
        return {
          checkpoint,
          ...retainPendingRequest<Request>(state, request),
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
    }
  }

  return applyAcceptedEvent;
}
