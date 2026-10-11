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
