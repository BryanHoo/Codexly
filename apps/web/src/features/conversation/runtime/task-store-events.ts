import type { AgentEvent, AgentItem } from "@codexly/protocol";

import {
  MAX_RETAINED_TASK_NOTICES,
  PENDING_COMMAND_LABEL,
  createTaskItemKey,
  createTaskItemStore,
  readTaskItem,
  retainPendingRequest,
  type TaskItemStore,
  type TaskStoreState,
} from "./task-store-core.js";
import { mergeRealtimeExpandedSkill } from "./task-store-skill.js";
export function getTouchedCommandOutputItemKeys(
  previousState: TaskStoreState,
  nextState: TaskStoreState,
  event: AgentEvent,
): readonly string[] | undefined {
  if (event.type === "command.output_delta") {
    return [createTaskItemKey(event.turnId, event.itemId)];
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const itemKey = createTaskItemKey(event.turnId, event.itemId);
    return event.payload.item.type === "command" ||
      previousState.commandOutputBytesByItemKey.has(itemKey)
      ? [itemKey]
      : undefined;
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return [
      ...(previousState.itemKeysByTurnId[event.turnId] ?? []),
      ...(nextState.itemKeysByTurnId[event.turnId] ?? []),
    ];
  }
  return undefined;
}
function createDeltaItem(event: Extract<AgentEvent, { itemId: string }>): AgentItem | undefined {
  switch (event.type) {
    case "message.delta":
      return {
        id: event.itemId,
        role: "assistant",
        text: "",
        type: "message",
      };
    case "reasoning.delta":
      return {
        content: "",
        id: event.itemId,
        summary: "",
        type: "reasoning",
      };
    case "plan.delta":
      return {
        id: event.itemId,
        text: "",
        type: "plan",
      };
    case "command.output_delta": {
      return {
        command: PENDING_COMMAND_LABEL,
        cwd: "",
        id: event.itemId,
        output: "",
        outputOmitted: { bytes: 0, lines: 0 },
        status: "running",
        type: "command",
      };
    }
    default:
      return undefined;
  }
}
function replaceTurnItems(
  state: TaskStoreState,
  turnId: string,
  items: readonly AgentItem[],
  changedItemStores: Set<TaskItemStore>,
): Pick<TaskStoreState, "itemKeysByTurnId"> {
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
      state.itemStoresByKey.set(itemKey, createTaskItemStore(item));
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
  state: TaskStoreState,
  turnId: string,
  terminalItems: readonly AgentItem[],
): readonly AgentItem[] {
  const submittedUserItemId = `submitted-user-${turnId}`;
  const terminalUserItem = terminalItems.find(
    (item) => item.type === "message" && item.role === "user",
  );
  const currentItems: AgentItem[] = [];
  const seenCurrentItemIds = new Set<string>();
  for (const itemKey of state.itemKeysByTurnId[turnId] ?? []) {
    const currentItem = readTaskItem(state, itemKey);
    if (currentItem === undefined) {
      continue;
    }
    // 启动响应可能缺少用户 Item；终态到达后由真实实体接管本地提交占位符。
    const resolvedItem =
      currentItem.id === submittedUserItemId && terminalUserItem !== undefined
        ? terminalUserItem
        : currentItem;
    if (!seenCurrentItemIds.has(resolvedItem.id)) {
      seenCurrentItemIds.add(resolvedItem.id);
      currentItems.push(resolvedItem);
    }
  }

  const currentItemIds = new Set(currentItems.map((item) => item.id));
  const terminalItemsById = new Map(terminalItems.map((item) => [item.id, item]));
  const terminalItemsBeforeCurrentId = new Map<string, AgentItem[]>();
  let pendingTerminalItems: AgentItem[] = [];
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
    ...currentItems.flatMap((item) => [
      ...(terminalItemsBeforeCurrentId.get(item.id) ?? []),
      terminalItemsById.get(item.id) ?? item,
    ]),
    ...pendingTerminalItems,
  ];
}

export function applyAcceptedEvent(
  state: TaskStoreState,
  event: AgentEvent,
  changedItemStores: Set<TaskItemStore>,
): Partial<TaskStoreState> {
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
        ...replaceTurnItems(state, event.turnId, items, changedItemStores),
        snapshotMetadata: {
          ...snapshotMetadata,
          status: "running",
          updatedAt: event.timestamp,
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        turnIds: [...state.turnIds.filter((turnId) => turnId !== event.turnId), event.turnId],
        turnsById: { ...state.turnsById, [event.turnId]: normalizedTurn },
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
      const createdItem = createDeltaItem(event);
      if (createdItem === undefined) {
        return { checkpoint };
      }
      const createdItemStore = createTaskItemStore(createdItem);
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
      const createdItemStore = createTaskItemStore({
        changes: event.payload.changes,
        id: event.itemId,
        status: "running",
        type: "file_change",
      });
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
      // 自动审批结果已由 approval_review Item 展示，避免 Guardian 摘要在底部永久重复出现。
      const notices =
        event.payload.code === "guardian_warning"
          ? state.notices
          : [...state.notices, event].slice(-MAX_RETAINED_TASK_NOTICES);
      return {
        checkpoint,
        notices,
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
    case "skills.changed":
    case "task.metadata_changed":
    case "task.removed":
      // Project 级缓存由 Runtime 回调同步，Task Store 只推进 checkpoint。
      return { checkpoint };
    case "item.started":
    case "item.completed": {
      if (state.turnsById[event.turnId] === undefined) {
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      const itemKey = createTaskItemKey(event.turnId, event.itemId);
      const currentItemStore = state.itemStoresByKey.get(itemKey);
      const itemAlreadyExists = currentItemStore !== undefined;
      const currentItemIds = state.itemKeysByTurnId[event.turnId] ?? [];
      const previousItemId = currentItemIds.at(-1);
      const previousItemStore =
        previousItemId === undefined ? undefined : state.itemStoresByKey.get(previousItemId);
      const mergedExpandedSkill = mergeRealtimeExpandedSkill(
        previousItemStore?.read(),
        event.payload.item,
      );
      if (mergedExpandedSkill !== undefined && previousItemStore !== undefined) {
        // Codex 将 Skill 展开为紧邻用户项；实时链路原位合并，避免产生第二个用户气泡。
        previousItemStore.replace(mergedExpandedSkill);
        changedItemStores.add(previousItemStore);
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      const submittedUserItemId = `submitted-user-${event.turnId}`;
      const submittedUserItemKey = createTaskItemKey(event.turnId, submittedUserItemId);
      const replacesSubmittedUserItem =
        event.payload.item.type === "message" &&
        event.payload.item.role === "user" &&
        currentItemIds.includes(submittedUserItemKey);
      const nextItemIds = replacesSubmittedUserItem
        ? currentItemIds
            .filter((candidateKey) => candidateKey !== submittedUserItemKey)
            .concat(itemAlreadyExists ? [] : itemKey)
        : itemAlreadyExists
          ? currentItemIds
          : [...currentItemIds, itemKey];
      // Provider 用户项到达后原子移除提交占位，避免同一输入重复展示。
      if (replacesSubmittedUserItem) {
        state.itemStoresByKey.delete(submittedUserItemKey);
      }
      if (currentItemStore === undefined) {
        state.itemStoresByKey.set(itemKey, createTaskItemStore(event.payload.item));
      } else {
        currentItemStore.replace(event.payload.item);
        changedItemStores.add(currentItemStore);
      }
      return {
        checkpoint,
        itemKeysByTurnId:
          nextItemIds === currentItemIds
            ? state.itemKeysByTurnId
            : { ...state.itemKeysByTurnId, [event.turnId]: nextItemIds },
        itemStructureRevision: state.itemStructureRevision + 1,
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    }
    case "turn.completed": {
      const currentTurn = state.turnsById[event.turnId];
      const nonRetryingProviderError = currentTurn?.status === "failed" ? currentTurn.error : null;
      // 失败终态缺少错误时，保留此前不可重试的 Provider 错误。
      const completedTurn =
        event.payload.turn.error === null && nonRetryingProviderError !== null
          ? { ...event.payload.turn, error: nonRetryingProviderError }
          : event.payload.turn;
      const { items: terminalItems, ...normalizedTurn } = completedTurn;
      const items = mergeTerminalTurnItems(state, event.turnId, terminalItems);
      return {
        checkpoint,
        ...(currentTurn === undefined
          ? {}
          : replaceTurnItems(state, event.turnId, items, changedItemStores)),
        // Notice 仅描述当前流式运行过程；Turn 终态到达后由最终回复或错误承载结果。
        notices: [],
        snapshotMetadata: {
          ...snapshotMetadata,
          status: completedTurn.status === "failed" ? "failed" : "idle",
          updatedAt: event.timestamp,
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        turnsById:
          currentTurn === undefined
            ? state.turnsById
            : { ...state.turnsById, [event.turnId]: normalizedTurn },
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
        ...retainPendingRequest(state, request),
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    }
  }
}
