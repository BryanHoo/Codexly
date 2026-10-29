import type { TaskEventTurn } from "./task-event-model.js";
import { mergeTurnItemTimings } from "./task-snapshot.js";

export function retainTurnItemTimings<Turn extends TaskEventTurn>(
  current: Turn | undefined,
  incoming: Turn,
): Turn {
  const itemTimings = mergeTurnItemTimings(current?.itemTimings, incoming.itemTimings);
  return itemTimings === undefined ? incoming : { ...incoming, itemTimings };
}

/** 只为可执行操作记录耗时；公开推理和普通消息不产生虚构的工具计时。 */
export function recordToolItemTiming<Turn extends TaskEventTurn>(
  turn: Turn,
  event: {
    type: "item.started" | "item.completed";
    itemId: string;
    timestamp: string;
    payload: { item: { type: string } };
  },
): Turn {
  const type = event.payload.item.type;
  if (type !== "command" && type !== "tool" && type !== "file_change") return turn;
  const timestampMs = Date.parse(event.timestamp);
  if (!Number.isFinite(timestampMs)) return turn;
  const previous = turn.itemTimings?.[event.itemId];
  const timing =
    event.type === "item.started"
      ? { ...previous, startedAtMs: previous?.startedAtMs ?? timestampMs }
      : { ...previous, completedAtMs: timestampMs };
  return { ...turn, itemTimings: { ...turn.itemTimings, [event.itemId]: timing } };
}
