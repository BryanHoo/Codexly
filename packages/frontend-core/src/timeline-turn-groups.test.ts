import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { describe, expect, it } from "vitest";
import { groupTimelineTurns, mergeTimelineTurns } from "./timeline-turn-groups.js";

function state(inputs: ("user" | "assistant" | "review" | undefined)[]) {
  const itemStoresByKey = new Map<string, { peek: () => AgentItem }>();
  const turnIds = inputs.map((_, index) => `turn-${String(index)}`);
  const itemKeysByTurnId: Record<string, string[]> = {};
  inputs.forEach((role, index) => {
    const id = `turn-${String(index)}`;
    itemKeysByTurnId[id] = role ? [id] : [];
    if (role)
      itemStoresByKey.set(id, {
        peek: () =>
          role === "review"
            ? ({ id, type: "review" } as AgentItem)
            : {
                id,
                type: "message",
                role,
                get text(): string {
                  throw new Error("Must not read message text");
                },
              },
      });
  });
  return { turnIds, itemKeysByTurnId, itemStoresByKey };
}

describe("timeline reply grouping", () => {
  it("groups Claude continuations, including a running empty stage, without reading text", () => {
    expect(
      groupTimelineTurns(state(["user", "assistant", undefined, "user", "assistant"]), "claude"),
    ).toEqual([
      { id: "turn-0", turnIds: ["turn-0", "turn-1", "turn-2"] },
      { id: "turn-3", turnIds: ["turn-3", "turn-4"] },
    ]);
  });

  it("preserves a partial reply when older user history has not been loaded", () => {
    expect(
      groupTimelineTurns(state(["assistant", "assistant", "review", "assistant"]), "claude"),
    ).toEqual([
      { id: "turn-0", turnIds: ["turn-0", "turn-1"] },
      { id: "turn-2", turnIds: ["turn-2", "turn-3"] },
    ]);
  });

  it.each([undefined, "codex"])("keeps native turns for engine %s", (engine) => {
    expect(groupTimelineTurns(state(["user", "assistant"]), engine)).toHaveLength(2);
  });

  it.each(["codex", "claude"])("reuses unchanged groups when %s adds items or turns", (engine) => {
    const previous = groupTimelineTurns(state(["user", "user"]), engine);
    const same = groupTimelineTurns(state(["user", "user"]), engine, previous);
    expect(same).toBe(previous);

    const next = groupTimelineTurns(state(["user", "user", "user"]), engine, previous);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toBe(previous[1]);
    expect(next[0]?.turnIds).toBe(previous[0]?.turnIds);
  });

  it("replaces only the extended Claude group and never mutates previous results", () => {
    const previous = groupTimelineTurns(state(["user", "assistant", "user"]), "claude");
    const next = groupTimelineTurns(
      state(["user", "assistant", "user", undefined]),
      "claude",
      previous,
    );
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).not.toBe(previous[1]);
    expect(next[1]?.turnIds).toEqual(["turn-2", "turn-3"]);
    expect(previous[1]?.turnIds).toEqual(["turn-2"]);
  });

  it("keeps unaffected identities after prepending history, removal and regrouping", () => {
    const full = state(["user", "assistant", "user", "assistant", "user"]);
    const previous = groupTimelineTurns({ ...full, turnIds: full.turnIds.slice(2) }, "claude");
    const prepended = groupTimelineTurns(full, "claude", previous);
    expect(prepended[1]).toBe(previous[0]);
    expect(prepended[2]).toBe(previous[1]);

    const split = state(["user", "user", "user", "assistant", "user"]);
    const regrouped = groupTimelineTurns(split, "claude", prepended);
    expect(regrouped[0]?.turnIds).toEqual(["turn-0"]);
    expect(regrouped[2]).toBe(previous[0]);
    expect(regrouped[3]).toBe(previous[1]);
    const removed = groupTimelineTurns(
      { ...split, turnIds: split.turnIds.slice(2) },
      "claude",
      regrouped,
    );
    expect(removed).toEqual(previous);
    expect(removed[0]).toBe(previous[0]);
  });

  it("recomputes boundaries when an existing item changes role without changing keys", () => {
    const input = state(["user", "assistant", "user"]);
    const previous = groupTimelineTurns(input, "claude");
    input.itemStoresByKey.set("turn-1", {
      peek: () => ({ id: "turn-1", type: "message", role: "user", text: "" }),
    });
    const next = groupTimelineTurns(input, "claude", previous);
    expect(next.map((group) => group.turnIds)).toEqual([["turn-0"], ["turn-1"], ["turn-2"]]);
    expect(next[2]).toBe(previous[1]);
    expect(groupTimelineTurns(input, "codex", next)).toBe(next);
  });

  it("keeps the final native fork identity, full interval, errors and stage tool timings", () => {
    const first: Omit<AgentTurn, "items"> = {
      id: "first",
      startedAt: "start",
      completedAt: "middle",
      status: "completed",
      error: "stage error",
      itemTimings: { a: { startedAtMs: 0, completedAtMs: 1000 } },
    };
    const last: typeof first = {
      id: "last",
      startedAt: "resume",
      completedAt: null,
      status: "running",
      error: null,
      forkable: false,
    };
    expect(mergeTimelineTurns([first, last])).toEqual({
      ...last,
      startedAt: "start",
      error: "stage error",
      itemTimings: first.itemTimings,
    });
    expect(mergeTimelineTurns([first])).toBe(first);
  });
});
