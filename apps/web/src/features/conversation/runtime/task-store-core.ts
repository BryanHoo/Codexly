import type { AgentEventConnectionState } from "@codexly/client";
import type {
  AgentEvent,
  AgentItem,
  AgentTaskSnapshot,
  AgentTurn,
  EventCheckpoint,
  PendingRequest,
} from "@codexly/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { estimateRetainedBytes, getUtf8ByteLength } from "../../../shared/memory/byte-lru.js";
import { CommandOutputBuffer, type CommandOutputView } from "./command-output-buffer.js";

export const MAX_TASK_COMMAND_OUTPUT_BYTES = 8 * 1_048_576;
export const MAX_RETAINED_TASK_RUNTIME_BYTES = 64 * 1_048_576;
export const MAX_RETAINED_TERMINAL_REQUESTS = 20;
export const MAX_RETAINED_TASK_NOTICES = 20;
export const PENDING_COMMAND_LABEL = "__CODEXLY_PENDING_COMMAND__";
export const RETAINED_COMMAND_OUTPUT_MARKER = "__CODEXLY_RETAINED_COMMAND_OUTPUT__";
const textEncoder = new TextEncoder();
const retainedCommandOutputMarkerBytes = textEncoder.encode(
  RETAINED_COMMAND_OUTPUT_MARKER,
).byteLength;

export type NormalizedAgentTurn = Omit<AgentTurn, "items">;
export type TaskNotice = Extract<AgentEvent, { type: "task.notice" }>;
export type TaskSnapshotMetadata = Omit<
  AgentTaskSnapshot,
  "pendingRequests" | "turns" | "turnsNextCursor"
>;
export type ReconstructedTaskSnapshot = Omit<AgentTaskSnapshot, "pendingRequests"> &
  Readonly<{ pendingRequests: readonly PendingRequest[] }>;
export type TaskStoreHydrationResponse = Readonly<{
  checkpoint: EventCheckpoint;
  snapshot: ReconstructedTaskSnapshot;
}>;

export interface TaskStoreIdentity {
  projectId: string;
  taskId: string;
}

export interface TaskStoreState {
  applyEvents: (events: readonly AgentEvent[]) => void;
  checkpoint: EventCheckpoint | null;
  commandOutputAccessByItemKey: Map<string, number>;
  commandOutputAccessSequence: number;
  commandOutputBytesByItemKey: Map<string, number>;
  commandOutputBytes: number;
  connectionState: AgentEventConnectionState;
  error: Error | null;
  hydrate: (response: TaskStoreHydrationResponse) => void;
  itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
  itemStoresByKey: Map<string, TaskItemStore>;
  itemStructureRevision: number;
  getItem: (itemId: string, turnId: string) => AgentItem | undefined;
  getItemByKey: (itemKey: string) => AgentItem | undefined;
  notices: readonly TaskNotice[];
  pendingRequestIds: readonly string[];
  pendingRequestsById: Readonly<Record<string, PendingRequest>>;
  prependHistory: (response: TaskStoreHydrationResponse) => void;
  projectId: string;
  reconcile: (response: TaskStoreHydrationResponse) => void;
  reconstructSnapshot: () => ReconstructedTaskSnapshot | undefined;
  retainedBytes: number;
  setConnectionState: (connectionState: AgentEventConnectionState) => void;
  setError: (error: Error | null) => void;
  snapshotMetadata: TaskSnapshotMetadata | null;
  taskId: string;
  turnIds: readonly string[];
  turnsNextCursor: string | null;
  turnsById: Readonly<Record<string, NormalizedAgentTurn>>;
}

export type TaskStore = StoreApi<TaskStoreState>;

export interface TaskItemStoreState {
  revision: number;
}

type DeltaEvent = Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta" }
>;

export interface TaskItemStore extends StoreApi<TaskItemStoreState> {
  appendDelta: (event: DeltaEvent) => boolean;
  getRetainedBytes: () => number;
  peek: () => AgentItem;
  publish: () => void;
  read: () => AgentItem;
  readCommandOutput: () => CommandOutputView | undefined;
  replace: (item: AgentItem) => void;
}

type StreamedTextField = "content" | "plan" | "summary" | "text";

function createBaseItem(item: AgentItem): AgentItem {
  if (item.type !== "command" || item.output === RETAINED_COMMAND_OUTPUT_MARKER) {
    return item;
  }
  const baseCommand = { ...item };
  delete baseCommand.output;
  return baseCommand;
}

export function createTaskItemStore(initialItem: AgentItem): TaskItemStore {
  let baseItem = createBaseItem(initialItem);
  // Delta 热路径只追加 Chunk；完整字符串仅在目标 Item 被读取时延迟物化并缓存。
  const chunksByField = new Map<StreamedTextField, string[]>();
  let contentGeneration = 0;
  let materializedGeneration = initialItem.type === "command" ? -1 : 0;
  let materializedItem = baseItem;
  let summarySectionIndex: number | undefined;
  let summaryLength = initialItem.type === "reasoning" ? initialItem.summary.length : 0;
  let commandOutputBuffer =
    initialItem.type === "command"
      ? new CommandOutputBuffer(initialItem.output, initialItem.outputTruncated)
      : undefined;
  let retainedBytes =
    estimateRetainedBytes(baseItem) + (commandOutputBuffer?.getView().outputBytes ?? 0);
  const store = createStore<TaskItemStoreState>()(() => ({ revision: 0 }));

  function appendChunk(field: StreamedTextField, delta: string): void {
    const chunks = chunksByField.get(field);
    if (chunks === undefined) {
      chunksByField.set(field, [delta]);
    } else {
      chunks.push(delta);
    }
    if (field === "summary") {
      summaryLength += delta.length;
    }
    retainedBytes += getUtf8ByteLength(delta);
    contentGeneration += 1;
  }

  return Object.assign(store, {
    appendDelta(event: DeltaEvent): boolean {
      if (event.type === "message.delta") {
        if (baseItem.type !== "message" || baseItem.role !== "assistant") {
          return false;
        }
        appendChunk("text", event.payload.delta);
        return true;
      }
      if (event.type === "reasoning.delta") {
        if (baseItem.type !== "reasoning") {
          return false;
        }
        if (event.payload.field === "summary" && event.payload.sectionIndex !== undefined) {
          const startsNewSection =
            summarySectionIndex === undefined
              ? event.payload.sectionIndex > 0
              : event.payload.sectionIndex !== summarySectionIndex;
          if (startsNewSection && summaryLength > 0) {
            // Codex 只传分段索引；用空行保留摘要段落边界，避免不同主题粘连。
            appendChunk("summary", "\n\n");
          }
          summarySectionIndex = event.payload.sectionIndex;
        }
        appendChunk(event.payload.field, event.payload.delta);
        return true;
      }
      if (event.type === "plan.delta") {
        if (baseItem.type !== "plan") {
          return false;
        }
        appendChunk("plan", event.payload.delta);
        return true;
      }
      if (baseItem.type !== "command") {
        return false;
      }
      const previousOutputBytes = commandOutputBuffer?.getView().outputBytes ?? 0;
      commandOutputBuffer?.append(event.payload.delta);
      retainedBytes += (commandOutputBuffer?.getView().outputBytes ?? 0) - previousOutputBytes;
      contentGeneration += 1;
      return true;
    },
    getRetainedBytes: (): number => retainedBytes,
    peek: (): AgentItem => baseItem,
    publish(): void {
      store.setState((state) => ({ revision: state.revision + 1 }));
    },
    read(): AgentItem {
      if (materializedGeneration === contentGeneration) {
        return materializedItem;
      }
      let nextItem = baseItem;
      if (baseItem.type === "message") {
        const chunks = chunksByField.get("text");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, text: [baseItem.text, ...chunks].join("") };
        }
      } else if (baseItem.type === "reasoning") {
        const contentChunks = chunksByField.get("content");
        const summaryChunks = chunksByField.get("summary");
        if (contentChunks !== undefined || summaryChunks !== undefined) {
          nextItem = {
            ...baseItem,
            content:
              contentChunks === undefined
                ? baseItem.content
                : [baseItem.content, ...contentChunks].join(""),
            summary:
              summaryChunks === undefined
                ? baseItem.summary
                : [baseItem.summary, ...summaryChunks].join(""),
          };
        }
      } else if (baseItem.type === "command") {
        const commandOutput = commandOutputBuffer?.getView();
        if (commandOutput !== undefined) {
          nextItem = {
            ...baseItem,
            ...(commandOutput.hasOutput ? { output: commandOutput.materialize() } : {}),
            outputTruncated: commandOutput.outputTruncated,
          };
        }
      } else if (baseItem.type === "plan") {
        const chunks = chunksByField.get("plan");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, text: [baseItem.text, ...chunks].join("") };
        }
      }
      materializedItem = nextItem;
      materializedGeneration = contentGeneration;
      return materializedItem;
    },
    readCommandOutput(): CommandOutputView | undefined {
      return commandOutputBuffer?.getView();
    },
    replace(item: AgentItem): void {
      baseItem = createBaseItem(item);
      chunksByField.clear();
      summarySectionIndex = undefined;
      summaryLength = item.type === "reasoning" ? item.summary.length : 0;
      commandOutputBuffer =
        item.type === "command"
          ? new CommandOutputBuffer(item.output, item.outputTruncated)
          : undefined;
      retainedBytes =
        estimateRetainedBytes(baseItem) + (commandOutputBuffer?.getView().outputBytes ?? 0);
      contentGeneration += 1;
    },
  });
}

type NormalizedTaskData = Pick<
  TaskStoreState,
  | "checkpoint"
  | "commandOutputAccessByItemKey"
  | "commandOutputAccessSequence"
  | "commandOutputBytesByItemKey"
  | "commandOutputBytes"
  | "itemKeysByTurnId"
  | "itemStoresByKey"
  | "itemStructureRevision"
  | "notices"
  | "pendingRequestIds"
  | "pendingRequestsById"
  | "retainedBytes"
  | "snapshotMetadata"
  | "turnIds"
  | "turnsNextCursor"
  | "turnsById"
>;

type PendingRequestState = Pick<TaskStoreState, "pendingRequestIds" | "pendingRequestsById">;

export function retainPendingRequest(
  state: PendingRequestState,
  request: PendingRequest,
): PendingRequestState {
  const requestAlreadyExists = state.pendingRequestsById[request.requestId] !== undefined;
  let pendingRequestIds = state.pendingRequestIds;
  if (request.status !== "pending") {
    // 终态按事件到达顺序移到末尾，容量淘汰基于实际结束时间而非创建时间。
    pendingRequestIds = [
      ...state.pendingRequestIds.filter((requestId) => requestId !== request.requestId),
      request.requestId,
    ];
  } else if (!requestAlreadyExists) {
    pendingRequestIds = [...state.pendingRequestIds, request.requestId];
  }
  const pendingRequestsById = {
    ...state.pendingRequestsById,
    [request.requestId]: request,
  };
  const terminalRequestIds = pendingRequestIds.filter(
    (requestId) => pendingRequestsById[requestId]?.status !== "pending",
  );
  const evictedRequestIds = new Set(terminalRequestIds.slice(0, -MAX_RETAINED_TERMINAL_REQUESTS));
  if (evictedRequestIds.size === 0) {
    return { pendingRequestIds, pendingRequestsById };
  }

  // 活动请求全部保留；终态只保留最近一段，避免长会话持续扩大 Store 和 Timeline 遍历量。
  return {
    pendingRequestIds: pendingRequestIds.filter((requestId) => !evictedRequestIds.has(requestId)),
    pendingRequestsById: Object.fromEntries(
      Object.entries(pendingRequestsById).filter(
        ([requestId]) => !evictedRequestIds.has(requestId),
      ),
    ),
  };
}

export function createTaskItemKey(turnId: string, itemId: string): string {
  return JSON.stringify([turnId, itemId]);
}

export function readTaskItem(state: TaskStoreState, itemKey: string): AgentItem | undefined {
  return state.itemStoresByKey.get(itemKey)?.read();
}

export function normalizeSnapshot(response: TaskStoreHydrationResponse): NormalizedTaskData {
  const { pendingRequests, turns, turnsNextCursor, ...snapshotMetadata } = response.snapshot;
  const turnIds: string[] = [];
  const turnsById: Record<string, NormalizedAgentTurn> = {};
  const itemKeysByTurnId: Record<string, readonly string[]> = {};
  const itemStoresByKey = new Map<string, TaskItemStore>();

  for (const turn of turns) {
    const { items, ...normalizedTurn } = turn;
    turnIds.push(turn.id);
    turnsById[turn.id] = normalizedTurn;
    itemKeysByTurnId[turn.id] = items.map((item) => createTaskItemKey(turn.id, item.id));
    for (const item of items) {
      const itemKey = createTaskItemKey(turn.id, item.id);
      itemStoresByKey.set(itemKey, createTaskItemStore(item));
    }
  }

  let pendingRequestState: PendingRequestState = {
    pendingRequestIds: [],
    pendingRequestsById: {},
  };
  for (const request of pendingRequests) {
    pendingRequestState = retainPendingRequest(pendingRequestState, request);
  }

  const { budget: boundedCommandOutputs } = updateCommandOutputBudget({
    previousBudget: {
      commandOutputAccessByItemKey: new Map<string, number>(),
      commandOutputAccessSequence: 0,
      commandOutputBytes: 0,
      commandOutputBytesByItemKey: new Map<string, number>(),
    },
    sourceItemStoresByKey: itemStoresByKey,
    touchedItemKeys: [...itemStoresByKey.keys()],
  });
  let retainedBytes =
    estimateRetainedBytes(response.checkpoint) +
    estimateRetainedBytes(snapshotMetadata) +
    estimateRetainedBytes(turnsNextCursor);
  for (const turnId of turnIds) {
    retainedBytes += estimateRetainedBytes(turnsById[turnId]);
    for (const itemKey of itemKeysByTurnId[turnId] ?? []) {
      retainedBytes += itemStoresByKey.get(itemKey)?.getRetainedBytes() ?? 0;
    }
  }
  for (const requestId of pendingRequestState.pendingRequestIds) {
    retainedBytes += estimateRetainedBytes(pendingRequestState.pendingRequestsById[requestId]);
  }

  return {
    checkpoint: response.checkpoint,
    ...boundedCommandOutputs,
    itemKeysByTurnId,
    itemStoresByKey,
    itemStructureRevision: 0,
    notices: [],
    ...pendingRequestState,
    retainedBytes,
    snapshotMetadata,
    turnIds,
    turnsNextCursor,
    turnsById,
  };
}

type CommandOutputBudgetState = Pick<
  TaskStoreState,
  | "commandOutputAccessByItemKey"
  | "commandOutputAccessSequence"
  | "commandOutputBytes"
  | "commandOutputBytesByItemKey"
>;

export type CommandOutputBudgetUpdate = Readonly<{
  budget: CommandOutputBudgetState;
  retainedBytesDeltaByItemKey: ReadonlyMap<string, number>;
}>;

type CommandOutputBudgetInput = Readonly<{
  previousBudget: Pick<
    TaskStoreState,
    | "commandOutputAccessByItemKey"
    | "commandOutputAccessSequence"
    | "commandOutputBytes"
    | "commandOutputBytesByItemKey"
  >;
  changedItemStores?: Set<TaskItemStore>;
  sourceItemStoresByKey: ReadonlyMap<string, TaskItemStore>;
  touchedItemKeys: readonly string[];
}>;

export function updateCommandOutputBudget(
  input: CommandOutputBudgetInput,
): CommandOutputBudgetUpdate {
  const commandOutputAccessByItemKey = input.previousBudget.commandOutputAccessByItemKey;
  const commandOutputBytesByItemKey = input.previousBudget.commandOutputBytesByItemKey;
  let commandOutputAccessSequence = input.previousBudget.commandOutputAccessSequence;
  let commandOutputBytes = input.previousBudget.commandOutputBytes;
  const retainedBytesDeltaByItemKey = new Map<string, number>();

  for (const itemKey of new Set(input.touchedItemKeys)) {
    const previousOutputBytes = commandOutputBytesByItemKey.get(itemKey) ?? 0;
    const itemStore = input.sourceItemStoresByKey.get(itemKey);
    const commandOutput = itemStore?.readCommandOutput();
    if (!commandOutput?.hasOutput) {
      commandOutputAccessByItemKey.delete(itemKey);
      commandOutputBytesByItemKey.delete(itemKey);
      commandOutputBytes -= previousOutputBytes;
      continue;
    }

    commandOutputAccessSequence += 1;
    commandOutputAccessByItemKey.set(itemKey, commandOutputAccessSequence);
    commandOutputBytesByItemKey.set(itemKey, commandOutput.outputBytes);
    commandOutputBytes += commandOutput.outputBytes - previousOutputBytes;
  }

  if (commandOutputBytes <= MAX_TASK_COMMAND_OUTPUT_BYTES) {
    return {
      budget: {
        commandOutputAccessByItemKey,
        commandOutputAccessSequence,
        commandOutputBytes,
        commandOutputBytesByItemKey,
      },
      retainedBytesDeltaByItemKey,
    };
  }

  // 仅在任务预算溢出时遍历 LRU 索引，流式热路径无需扫描全部 Timeline Item。
  const leastRecentlyUsedItemKeys = [...commandOutputAccessByItemKey.keys()].toSorted(
    (leftItemKey, rightItemKey) =>
      (commandOutputAccessByItemKey.get(leftItemKey) ?? 0) -
      (commandOutputAccessByItemKey.get(rightItemKey) ?? 0),
  );
  for (const itemKey of leastRecentlyUsedItemKeys) {
    if (commandOutputBytes <= MAX_TASK_COMMAND_OUTPUT_BYTES) {
      break;
    }
    const itemStore = input.sourceItemStoresByKey.get(itemKey);
    const item = itemStore?.peek();
    if (itemStore === undefined || item?.type !== "command") {
      continue;
    }
    const previousOutputBytes = commandOutputBytesByItemKey.get(itemKey) ?? 0;
    const previousRetainedBytes = itemStore.getRetainedBytes();
    itemStore.replace({
      ...item,
      output: RETAINED_COMMAND_OUTPUT_MARKER,
      outputTruncated: true,
    });
    input.changedItemStores?.add(itemStore);
    commandOutputBytesByItemKey.set(itemKey, retainedCommandOutputMarkerBytes);
    commandOutputBytes -= previousOutputBytes - retainedCommandOutputMarkerBytes;
    retainedBytesDeltaByItemKey.set(itemKey, itemStore.getRetainedBytes() - previousRetainedBytes);
  }

  return {
    budget: {
      commandOutputAccessByItemKey,
      commandOutputAccessSequence,
      commandOutputBytes,
      commandOutputBytesByItemKey,
    },
    retainedBytesDeltaByItemKey,
  };
}
