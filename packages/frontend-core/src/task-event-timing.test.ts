import { expect, it } from "vitest";
import { retainTurnItemTimings } from "./task-event-timing.js";
import type { TaskEventTurn } from "./task-event-model.js";
import { reconcileTaskSnapshot } from "./task-snapshot.js";
const turn: TaskEventTurn = {
  id: "t",
  status: "running" as const,
  startedAt: null,
  completedAt: null,
  error: null,
};
it("实时回合使用事件时间补齐原生空时间，后续空值不能撤销计时", () => {
  const started = retainTurnItemTimings(undefined, turn, {
    type: "turn.started",
    timestamp: "2026-11-20T00:00:00Z",
  });
  expect(started.startedAt).toBe("2026-11-20T00:00:00Z");
  const ended = retainTurnItemTimings(
    started,
    { ...turn, status: "completed" as const },
    { type: "turn.completed", timestamp: "2026-11-20T00:00:12Z" },
  );
  expect(ended).toMatchObject({
    startedAt: started.startedAt,
    completedAt: "2026-11-20T00:00:12Z",
  });
  expect(retainTurnItemTimings(ended, { ...turn, status: "completed" as const })).toMatchObject({
    startedAt: started.startedAt,
    completedAt: ended.completedAt,
  });
  expect(
    retainTurnItemTimings(undefined, { ...turn, status: "completed" as const }).completedAt,
  ).toBeNull();
  const current = { ...ended, items: [] };
  const restored = reconcileTaskSnapshot(
    { sessionId: "s" },
    () => ({ turns: [current], turnsNextCursor: null }),
    {
      checkpoint: { sessionId: "s" },
      snapshot: {
        turns: [{ ...current, startedAt: null, completedAt: null }],
        turnsNextCursor: null,
      },
    },
  );
  expect(restored.snapshot.turns[0]).toMatchObject({
    startedAt: started.startedAt,
    completedAt: ended.completedAt,
  });
});
