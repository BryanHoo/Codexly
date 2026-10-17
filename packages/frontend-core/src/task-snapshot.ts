import type { AgentTurn } from "@codexly/protocol";
import { retainSnapshotTurnItems } from "./message-identity.js";

interface SnapshotTurns<Turn> {
  turns: readonly Turn[];
  turnsNextCursor: string | null;
}

export function mergeSnapshotTurns<
  Turn extends { id: string; items?: readonly { id: string }[] },
  Snapshot extends SnapshotTurns<Turn>,
>(
  current: SnapshotTurns<Turn>,
  incoming: Snapshot,
  mergeOverlap: (current: Turn, incoming: Turn) => Turn,
): Snapshot {
  const currentById = new Map(current.turns.map((turn) => [turn.id, turn]));
  const incomingIds = new Set(incoming.turns.map((turn) => turn.id));
  const overlap = current.turns.flatMap((turn, index) => (incomingIds.has(turn.id) ? [index] : []));
  const first = overlap.at(0);
  const last = overlap.at(-1);
  const partial = incoming.turnsNextCursor !== null && first !== undefined && last !== undefined;
  const older = partial
    ? current.turns.slice(0, first).filter((turn) => !incomingIds.has(turn.id))
    : [];
  const newer = partial
    ? current.turns.slice(last + 1).filter((turn) => !incomingIds.has(turn.id))
    : [];
  // 最新 Item 页与已加载内容连续重叠时，保留续页进度；无重叠则使用新游标补齐断线缺口。
  const retainedItemPage =
    partial &&
    incoming.turns.some((turn) => {
      const existing = currentById.get(turn.id);
      const anchor = turn.items?.[0];
      return (
        anchor !== undefined &&
        (existing?.items?.length ?? 0) > (turn.items?.length ?? 0) &&
        existing?.items?.some((item) => item.id === anchor.id)
      );
    });
  return {
    ...incoming,
    turns: [
      ...older,
      ...incoming.turns.map((turn) => {
        const existing = currentById.get(turn.id);
        return existing === undefined ? turn : mergeOverlap(existing, turn);
      }),
      ...newer,
    ],
    turnsNextCursor:
      older.length > 0 || retainedItemPage ? current.turnsNextCursor : incoming.turnsNextCursor,
  };
}

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

interface ReconciledTurn {
  id: string;
  items: { id: string; type: string; role?: string; identityAliases?: readonly string[] }[];
  itemTimings?: AgentTurn["itemTimings"];
}

export function reconcileTaskSnapshot<
  Turn extends ReconciledTurn,
  Response extends { checkpoint: { sessionId: string }; snapshot: SnapshotTurns<Turn> },
>(
  checkpoint: { sessionId: string } | null,
  readCurrentSnapshot: () => SnapshotTurns<Turn> | undefined,
  response: Response,
): Response {
  // 运行时重启后旧实体、过程时间和分页游标均失效；在读取旧正文前直接采用权威快照。
  if (checkpoint !== null && checkpoint.sessionId !== response.checkpoint.sessionId)
    return response;
  const current = readCurrentSnapshot();
  if (current === undefined) return response;
  return {
    ...response,
    snapshot: mergeSnapshotTurns<Turn, Response["snapshot"]>(
      current,
      response.snapshot,
      (currentTurn, incoming) => {
        const itemTimings = mergeTurnItemTimings(currentTurn.itemTimings, incoming.itemTimings);
        return {
          ...incoming,
          ...(itemTimings === undefined ? {} : { itemTimings }),
          items: retainSnapshotTurnItems(currentTurn.items, incoming.items, currentTurn.id),
        };
      },
    ),
  };
}
