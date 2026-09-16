import type { AgentTaskSnapshot } from "@codexly/protocol";

import type { HistoryLocation } from "./history-location.js";
import type { HistoryAnchor } from "./history-navigation.js";

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function resolveHistoryTarget(
  snapshot: Pick<AgentTaskSnapshot, "turns">,
  location: HistoryLocation,
): HistoryAnchor | null {
  const turn = snapshot.turns.find((candidate) => candidate.id === location.turnId);
  if (turn === undefined) return null;
  const messages = turn.items.filter((item) => item.type === "message");
  const matchedText = location.snippet
    .slice(location.snippetMatchRange.start, location.snippetMatchRange.end)
    .trim();
  const target = { ...location, highlightText: matchedText || location.query.trim() };
  if (messages.some((item) => item.id === location.itemId)) return target;

  // Item ID 变化时仅在同一回合存在唯一完整片段匹配时重新绑定。
  const snippet = normalized(location.snippet.replace(/^…|…$/gu, ""));
  if (!snippet) return null;
  const candidates = messages.filter((item) => normalized(item.text).includes(snippet));
  const candidate = candidates.at(0);
  return candidates.length === 1 && candidate !== undefined
    ? { ...target, itemId: candidate.id }
    : null;
}
