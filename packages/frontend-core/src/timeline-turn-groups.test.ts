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
