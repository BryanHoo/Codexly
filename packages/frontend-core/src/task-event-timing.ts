import type { TaskEventTurn } from "./task-event-model.js";
import { mergeTurnItemTimings } from "./task-snapshot.js";

export function retainTurnItemTimings<Turn extends TaskEventTurn>(
  current: Turn | undefined,
  incoming: Turn,
  event?: { type: "turn.started" | "turn.completed"; timestamp: string },
): Turn {
  const itemTimings = mergeTurnItemTimings(current?.itemTimings, incoming.itemTimings);
  // 仅用实际收到的生命周期事件补齐空时间，不以页面挂载时间推算历史耗时。
  const observed = event && Number.isFinite(Date.parse(event.timestamp)) ? event.timestamp : null;
  return {
    ...incoming,
    startedAt:
      incoming.startedAt ??
      current?.startedAt ??
      (event?.type === "turn.started" ? observed : null),
    completedAt:
      incoming.completedAt ??
      current?.completedAt ??
      (event?.type === "turn.completed" ? observed : null),
    ...(itemTimings === undefined ? {} : { itemTimings }),
  };
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
