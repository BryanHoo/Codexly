import { describe, expect, it } from "vitest";
import { mergeSnapshotTurns } from "./task-snapshot.js";

describe("mergeSnapshotTurns", () => {
  it("preserves older and live newer turns around a partial snapshot", () => {
    const turn = (id: string) => ({ id, items: [{ id }] });
    const result = mergeSnapshotTurns(
      { turns: [turn("old"), turn("overlap"), turn("live")], turnsNextCursor: "older" },
      { turns: [turn("overlap")], turnsNextCursor: "cursor" },
      (current, incoming) => ({ ...incoming, items: [...current.items, ...incoming.items] }),
    );
    expect(result.turns.map((item) => item.id)).toEqual(["old", "overlap", "live"]);
    expect(result.turns[1]?.items).toHaveLength(2);
    expect(result.turnsNextCursor).toBe("older");
  });

  it("does not replay older turns when the snapshot has full history", () => {
    const current = { turns: [{ id: "old" }], turnsNextCursor: "older" };
    const incoming = { turns: [{ id: "new" }], turnsNextCursor: null };
    expect(mergeSnapshotTurns(current, incoming, (_, turn) => turn)).toEqual(incoming);
  });
});
