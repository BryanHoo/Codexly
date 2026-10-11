import { describe, expect, it } from "vitest";
import { mergeSnapshotTurns } from "./task-snapshot.js";

it("retains the item continuation after recovery of an overlapping newest item page", () => {
  const current = {
    turns: [{ id: "turn", items: [{ id: "old" }, { id: "anchor" }, { id: "new" }] }],
    turnsNextCursor: "remaining-items",
  };
  const incoming = {
    turns: [{ id: "turn", items: [{ id: "anchor" }, { id: "new" }] }],
    turnsNextCursor: "initial-items",
  };
  expect(mergeSnapshotTurns(current, incoming, (existing) => existing).turnsNextCursor).toBe(
    "remaining-items",
  );
});

it("uses the new item continuation when recovery has no item overlap and must fill a gap", () => {
  const current = {
    turns: [{ id: "turn", items: [{ id: "old" }, { id: "older" }] }],
    turnsNextCursor: "remaining-items",
  };
  const incoming = {
    turns: [{ id: "turn", items: [{ id: "new" }] }],
    turnsNextCursor: "gap-items",
  };
  expect(mergeSnapshotTurns(current, incoming, (existing) => existing).turnsNextCursor).toBe(
    "gap-items",
  );
});

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
