import { reconcileTaskSnapshot } from "@codexly/frontend-core";
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

export function reconcileSnapshot(
  state: TaskStoreState,
  response: TaskStoreHydrationResponse,
): TaskStoreHydrationResponse {
  return reconcileTaskSnapshot(state.checkpoint, () => reconstructSnapshot(state), response);
}
