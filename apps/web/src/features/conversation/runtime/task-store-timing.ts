import type { AgentEvent } from "@codexly/protocol";

import type { NormalizedAgentTurn } from "./task-store-core.js";

import { mergeTurnItemTimings } from "@codexly/frontend-core";
export { mergeTurnItemTimings };

export function retainTurnItemTimings(
  current: NormalizedAgentTurn | undefined,
  incoming: NormalizedAgentTurn,
): NormalizedAgentTurn {
  const itemTimings = mergeTurnItemTimings(current?.itemTimings, incoming.itemTimings);
  return itemTimings === undefined ? incoming : { ...incoming, itemTimings };
}

export function recordToolItemTiming(
  turn: NormalizedAgentTurn,
  event: Extract<AgentEvent, { type: "item.started" | "item.completed" }>,
): NormalizedAgentTurn {
  if (
    event.payload.item.type !== "command" &&
    event.payload.item.type !== "tool" &&
    event.payload.item.type !== "file_change"
  )
    return turn;
  const timestampMs = Date.parse(event.timestamp);
  if (!Number.isFinite(timestampMs)) return turn;
  const previous = turn.itemTimings?.[event.itemId];
  const timing =
    event.type === "item.started"
      ? { ...previous, startedAtMs: previous?.startedAtMs ?? timestampMs }
      : { ...previous, completedAtMs: timestampMs };
  return { ...turn, itemTimings: { ...turn.itemTimings, [event.itemId]: timing } };
}
