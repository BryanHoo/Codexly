import type { AgentEvent, AgentTurn } from "@codexly/protocol";

import type { NormalizedAgentTurn } from "./task-store-core.js";

export function mergeTurnItemTimings(
  current: AgentTurn["itemTimings"],
  incoming: AgentTurn["itemTimings"],
): AgentTurn["itemTimings"] {
  if (current === undefined) return incoming;
  if (incoming === undefined) return current;
  const merged = { ...current };
  for (const [itemId, timing] of Object.entries(incoming)) {
    merged[itemId] = { ...current[itemId], ...timing };
  }
  return merged;
}

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
  if (event.payload.item.type !== "command" && event.payload.item.type !== "tool") return turn;
  const timestampMs = Date.parse(event.timestamp);
  if (!Number.isFinite(timestampMs)) return turn;
  const previous = turn.itemTimings?.[event.itemId];
  const timing =
    event.type === "item.started"
      ? { ...previous, startedAtMs: previous?.startedAtMs ?? timestampMs }
      : { ...previous, completedAtMs: timestampMs };
  return { ...turn, itemTimings: { ...turn.itemTimings, [event.itemId]: timing } };
}
