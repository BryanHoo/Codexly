import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { mergeSnapshotTurns } from "@codexly/frontend-core";
import { resolveMessageAliases } from "./task-store-identity.js";
import { mergeTurnItemTimings } from "./task-store-timing.js";

import {
  readTaskItem,
  type ReconstructedTaskSnapshot,
  type TaskStoreHydrationResponse,
  type TaskStoreState,
} from "./task-store-core.js";

export function reconstructSnapshot(state: TaskStoreState): ReconstructedTaskSnapshot | undefined {
  if (state.snapshotMetadata === null) {
    return undefined;
  }
  return {
    ...state.snapshotMetadata,
    pendingRequests: state.pendingRequestIds.flatMap((requestId) => {
      const request = state.pendingRequestsById[requestId];
      // 兼容快照遵守 HTTP Schema，只重建仍可操作的 pending 请求。
      return request?.status === "pending" ? [request] : [];
    }),
    turnsNextCursor: state.turnsNextCursor,
    turns: state.turnIds.flatMap((turnId) => {
      const turn = state.turnsById[turnId];
      if (turn === undefined) {
        return [];
      }
      const items = (state.itemKeysByTurnId[turnId] ?? []).flatMap((itemId) => {
        const item = readTaskItem(state, itemId);
        return item === undefined ? [] : [item];
      });
      return [{ ...turn, items }];
    }),
  };
}

function retainSnapshotTurnItems(currentTurn: AgentTurn, snapshotTurn: AgentTurn): AgentItem[] {
  const incoming = new Map(snapshotTurn.items.map((item) => [item.id, item]));
  const current = resolveMessageAliases(currentTurn.items, snapshotTurn.items, currentTurn.id);
  const retained = current.map((item) => {
    const authoritative = incoming.get(item.id);
    incoming.delete(item.id);
    return authoritative ?? item;
  });
  // 未持久化的实时操作仍保留；身份映射只能来自 Node 的明确别名。
  return [...retained, ...incoming.values()];
}

export function reconcileSnapshot(
  state: TaskStoreState,
  response: TaskStoreHydrationResponse,
): TaskStoreHydrationResponse {
  if (state.checkpoint !== null && state.checkpoint.sessionId !== response.checkpoint.sessionId)
    return response;
  const currentSnapshot = reconstructSnapshot(state);
  if (currentSnapshot === undefined) {
    return response;
  }
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      ...mergeSnapshotTurns(currentSnapshot, response.snapshot, (currentTurn, snapshotTurn) => {
        const itemTimings = mergeTurnItemTimings(currentTurn.itemTimings, snapshotTurn.itemTimings);
        return {
          ...snapshotTurn,
          ...(itemTimings === undefined ? {} : { itemTimings }),
          items: retainSnapshotTurnItems(currentTurn, snapshotTurn),
        };
      }),
    },
  };
}
