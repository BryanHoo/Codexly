import type { AgentItem, AgentTurn } from "@codexly/protocol";

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

type AgentMessage = Extract<AgentItem, { type: "message" }>;

function retainSnapshotTurnItems(currentTurn: AgentTurn, snapshotTurn: AgentTurn): AgentItem[] {
  const snapshotItemsById = new Map(snapshotTurn.items.map((item) => [item.id, item]));
  const snapshotMessagesByCurrentId = new Map<string, AgentMessage>();
  const currentMessages = currentTurn.items.filter(
    (item): item is AgentMessage => item.type === "message",
  );
  const snapshotMessages = snapshotTurn.items.filter(
    (item): item is AgentMessage => item.type === "message",
  );
  const currentMessagesById = new Map(currentMessages.map((item) => [item.id, item]));
  const matchedCurrentMessageIds = new Set<string>();
  const matchedSnapshotMessageIds = new Set<string>();

  const retainSnapshotMessage = (currentMessage: AgentMessage, snapshotMessage: AgentMessage) => {
    matchedCurrentMessageIds.add(currentMessage.id);
    matchedSnapshotMessageIds.add(snapshotMessage.id);
    snapshotItemsById.delete(snapshotMessage.id);
    snapshotMessagesByCurrentId.set(currentMessage.id, {
      ...snapshotMessage,
      // 实时 ID 是后续 Delta 的稳定锚点，Snapshot 只补充权威内容与元数据。
      id: currentMessage.id,
    });
  };

  // ID 是实体身份的首要依据，先排除所有可确定的同一消息。
  for (const snapshotMessage of snapshotMessages) {
    const currentMessage = currentMessagesById.get(snapshotMessage.id);
    if (currentMessage !== undefined) {
      retainSnapshotMessage(currentMessage, snapshotMessage);
    }
  }

  const unmatchedCurrentMessages = currentMessages.filter(
    (message) => !matchedCurrentMessageIds.has(message.id),
  );
  const unmatchedSnapshotMessages = snapshotMessages.filter(
    (message) => !matchedSnapshotMessageIds.has(message.id),
  );
  const currentCandidatesBySnapshotId = new Map<string, AgentMessage[]>();
  const snapshotCandidateCountByCurrentId = new Map<string, number>();

  for (const snapshotMessage of unmatchedSnapshotMessages) {
    const candidates = unmatchedCurrentMessages.filter(
      (currentMessage) =>
        currentMessage.role === snapshotMessage.role &&
        currentMessage.text.length > 0 &&
        snapshotMessage.text.length > 0 &&
        (currentMessage.text.startsWith(snapshotMessage.text) ||
          snapshotMessage.text.startsWith(currentMessage.text)),
    );
    currentCandidatesBySnapshotId.set(snapshotMessage.id, candidates);
    for (const candidate of candidates) {
      snapshotCandidateCountByCurrentId.set(
        candidate.id,
        (snapshotCandidateCountByCurrentId.get(candidate.id) ?? 0) + 1,
      );
    }
  }

  // 文本只能在候选关系两侧都唯一时兜底，歧义消息保留各自 ID。
  for (const snapshotMessage of unmatchedSnapshotMessages) {
    const candidates = currentCandidatesBySnapshotId.get(snapshotMessage.id) ?? [];
    const currentMessage = candidates.length === 1 ? candidates[0] : undefined;
    if (
      currentMessage !== undefined &&
      snapshotCandidateCountByCurrentId.get(currentMessage.id) === 1
    ) {
      retainSnapshotMessage(currentMessage, snapshotMessage);
    }
  }

  const retainedItems = currentTurn.items.flatMap((currentItem) => {
    const snapshotMessage = snapshotMessagesByCurrentId.get(currentItem.id);
    if (snapshotMessage !== undefined) {
      return [snapshotMessage];
    }
    const snapshotItem = snapshotItemsById.get(currentItem.id);
    if (snapshotItem === undefined) {
      return [currentItem];
    }
    snapshotItemsById.delete(currentItem.id);
    return [snapshotItem];
  });

  // Snapshot 可能只包含持久化摘要；保留同一 Turn 已接收的操作，并追加 Snapshot 新增实体。
  return [...retainedItems, ...snapshotItemsById.values()];
}

export function reconcileSnapshot(
  state: TaskStoreState,
  response: TaskStoreHydrationResponse,
): TaskStoreHydrationResponse {
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
          return currentTurn === undefined
            ? snapshotTurn
            : {
                ...snapshotTurn,
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

export function mergeOlderHistoryPage(
  state: TaskStoreState,
  response: TaskStoreHydrationResponse,
): TaskStoreHydrationResponse {
  const currentSnapshot = reconstructSnapshot(state);
  if (currentSnapshot === undefined) {
    return response;
  }
  const currentTurnIds = new Set(currentSnapshot.turns.map((turn) => turn.id));
  return {
    checkpoint: state.checkpoint ?? response.checkpoint,
    snapshot: {
      ...currentSnapshot,
      // Codex Turn Cursor 不重叠；仍按 ID 去重，防止重复响应污染时间线。
      turns: [
        ...response.snapshot.turns.filter((turn) => !currentTurnIds.has(turn.id)),
        ...currentSnapshot.turns,
      ],
      turnsNextCursor: response.snapshot.turnsNextCursor,
    },
  };
}
