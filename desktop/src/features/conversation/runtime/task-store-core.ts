import type { AgentEventConnectionState } from "@/platform/native-client-types.js";
import type {
  AgentEvent,
  AgentItem,
  AgentTaskSnapshot,
  AgentTaskSettings,
  AgentTurn,
  EventCheckpoint,
  PendingRequest,
} from "@/protocol/index.js";
import type { StoreApi } from "zustand/vanilla";

import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
import { createTaskItemStore, RETAINED_COMMAND_OUTPUT_MARKER, type TaskItemStore } from "./task-item-store.js";

export { createTaskItemStore, RETAINED_COMMAND_OUTPUT_MARKER, type TaskItemStore, type TaskItemStoreState } from "./task-item-store.js";

export const MAX_TASK_COMMAND_OUTPUT_BYTES = 8 * 1_048_576;
export const MAX_RETAINED_TASK_RUNTIME_BYTES = 64 * 1_048_576;
export const MAX_RETAINED_TERMINAL_REQUESTS = 20;
export const MAX_RETAINED_TASK_NOTICES = 20;
export const PENDING_COMMAND_LABEL = "__CODEXLY_PENDING_COMMAND__";
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
  writeAccess: "checking" | "writable" | "external" | "unavailable";
  setWriteAccess: (access: TaskStoreState["writeAccess"]) => void;
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
  setTaskSettings: (settings: AgentTaskSettings) => void;
  snapshotMetadata: TaskSnapshotMetadata | null;
  taskId: string;
  turnIds: readonly string[];
  turnsNextCursor: string | null;
  turnsById: Readonly<Record<string, NormalizedAgentTurn>>;
}

export type TaskStore = StoreApi<TaskStoreState>;


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
    const commandOutput = itemStore.readCommandOutput();
    itemStore.replace({
      ...item,
      output: RETAINED_COMMAND_OUTPUT_MARKER,
      outputOmitted: {
        bytes:
          (commandOutput?.outputOmitted.bytes ?? item.outputOmitted.bytes) + previousOutputBytes,
        lines:
          (commandOutput?.outputOmitted.lines ?? item.outputOmitted.lines) +
          (commandOutput?.outputLines ?? 0),
      },
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
