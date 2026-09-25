import type { AgentTaskSnapshot } from "@/protocol/index.js";
import type { HistoryLocation } from "./history-location.js";
import type { HistoryAnchor } from "./history-navigation.js";

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function resolveHistoryTarget(
  snapshot: Pick<AgentTaskSnapshot, "turns">,
  location: HistoryLocation,
): HistoryAnchor | null {
  const turn = snapshot.turns.find((candidate) => candidate.id === location.turnId);
  if (turn === undefined) return null;

  const messages = turn.items.filter(
    (item) => item.type === "message",
  );
  const exact = messages.find((item) => item.id === location.itemId);
  if (exact !== undefined) return location;

  // 只有完整片段唯一对应同回合消息时才重绑，禁止用一个关键词猜测另一条消息。
  const snippet = normalized(location.snippet.replace(/^…|…$/g, ""));
  if (!snippet) return null;
  const candidates = messages.filter((item) => normalized(item.text).includes(snippet));
  return candidates.length === 1 ? { ...location, itemId: candidates[0]!.id } : null;
}
