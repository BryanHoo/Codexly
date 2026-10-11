import type { AgentTurn } from "@codexly/protocol";

type TurnMetadata = Omit<AgentTurn, "items">;
type HistoryIndex = Readonly<{
  turnIds: readonly string[];
  itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
  turnsById: Readonly<Record<string, TurnMetadata>>;
}>;

/** 两端共用的历史前插：只接收新 Item，保留已有实时实体与回合状态。 */
export function prependTaskHistoryPage(current: HistoryIndex, incoming: HistoryIndex) {
  const addedTurnIds = incoming.turnIds.filter((id) => current.turnsById[id] === undefined);
  const addedItemKeys = new Set<string>();
  const itemKeysByTurnId = { ...current.itemKeysByTurnId };
  const turnsById = { ...current.turnsById };
  for (const id of incoming.turnIds) {
    const turn = incoming.turnsById[id];
    if (turn === undefined) continue;
    const existing = current.turnsById[id];
    const existingKeys = current.itemKeysByTurnId[id] ?? [];
    const known = new Set(existingKeys);
    const olderKeys = (incoming.itemKeysByTurnId[id] ?? []).filter((key) => {
      if (known.has(key)) return false;
      known.add(key);
      addedItemKeys.add(key);
      return true;
    });
    itemKeysByTurnId[id] = [...olderKeys, ...existingKeys];
    if (existing === undefined) {
      turnsById[id] = turn;
    } else if (turn.itemTimings !== undefined) {
      const timings = { ...existing.itemTimings };
      for (const [itemId, timing] of Object.entries(turn.itemTimings)) {
        // 历史只能补充缺失字段，不能覆盖实时事件已经记录的时间。
        timings[itemId] = { ...timing, ...timings[itemId] };
      }
      turnsById[id] = { ...existing, itemTimings: timings };
    }
  }
  return { addedItemKeys, addedTurnIds, itemKeysByTurnId, turnsById };
}
