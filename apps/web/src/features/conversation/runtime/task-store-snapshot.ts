import type { AgentItem, AgentTurn } from "@codexly/protocol";
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
  const currentTurnsById = new Map(currentSnapshot.turns.map((turn) => [turn.id, turn]));
  const snapshotTurnIds = new Set(response.snapshot.turns.map((turn) => turn.id));
  const overlappingIndexes = currentSnapshot.turns.flatMap((turn, index) =>
    snapshotTurnIds.has(turn.id) ? [index] : [],
  );
  const firstOverlap = overlappingIndexes.at(0);
  const lastOverlap = overlappingIndexes.at(-1);
  const preservesPartialHistory =
    response.snapshot.turnsNextCursor !== null &&
    firstOverlap !== undefined &&
    lastOverlap !== undefined;
  const retainedOlderTurns = preservesPartialHistory
    ? currentSnapshot.turns.slice(0, firstOverlap).filter((turn) => !snapshotTurnIds.has(turn.id))
    : [];
  const retainedNewerTurns = preservesPartialHistory
    ? currentSnapshot.turns.slice(lastOverlap + 1).filter((turn) => !snapshotTurnIds.has(turn.id))
    : [];
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      turns: [
        ...retainedOlderTurns,
        ...response.snapshot.turns.map((snapshotTurn) => {
          const currentTurn = currentTurnsById.get(snapshotTurn.id);
          if (currentTurn === undefined) return snapshotTurn;
          const itemTimings = mergeTurnItemTimings(
            currentTurn.itemTimings,
            snapshotTurn.itemTimings,
          );
          return {
            ...snapshotTurn,
            ...(itemTimings === undefined ? {} : { itemTimings }),
            items: retainSnapshotTurnItems(currentTurn, snapshotTurn),
          };
        }),
        ...retainedNewerTurns,
      ],
      turnsNextCursor:
        retainedOlderTurns.length > 0
          ? currentSnapshot.turnsNextCursor
          : response.snapshot.turnsNextCursor,
    },
  };
}
