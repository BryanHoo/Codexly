import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";
import { describe, expect, it, vi } from "vitest";

import { createTaskStore } from "./task-store.js";
import { createResponse, eventEnvelope, timestamp } from "./task-store.test-support.js";

it("estimates the output rate from accepted foreground text and expires idle samples", () => {
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
  const now = Date.parse(timestamp);
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const state = store.getState();
  const rates = new TurnOutputRates();
  state.turnOutputRates.current = rates;
  const turnId = "turn-running";
  const reply = {
    ...eventEnvelope(11),
    turnId,
    itemId: "message-running",
    type: "message.delta",
    payload: { delta: "text".repeat(40) },
  } as const;
  try {
    state.applyEvents([reply]);
    expect(rates.read(turnId, now)).toBeNull();
    clock.mockReturnValue(now + 1_000);
    state.applyEvents([
      {
        ...reply,
        sequence: 12,
        type: "reasoning.delta",
        itemId: "reasoning",
        payload: { ...reply.payload, field: "summary" },
      },
      { ...reply, sequence: 12 },
      { ...reply, sequence: 13, type: "command.output_delta", itemId: "terminal" },
      { ...reply, sequence: 14, turnId: "turn-completed", itemId: "message-completed" },
      { ...reply, sequence: 15, itemId: "acp:child:other:acp:message:assistant:reply" },
    ]);
    expect(rates.read(turnId, now + 1_000)).toBe(40);
    expect(rates.read(turnId, now + 4_000)).toBeNull();
    state.reconcile(createResponse());
    expect(rates.read(turnId, now + 1_000)).toBe(40);
    state.hydrate(createResponse());
    expect(rates.read(turnId, now + 1_000)).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

describe("streamed tool timing", () => {
  it("records file changes but does not invent reasoning timing", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const file: Extract<AgentItem, { type: "file_change" }> = {
      id: "files-1",
      changes: [],
      status: "running",
      type: "file_change",
    };
    const reasoning = {
      id: "reasoning-1",
      content: "",
      summary: "思考",
      type: "reasoning",
    } as const;
    for (const [sequence, type, item] of [
      [11, "item.started", file],
      [12, "item.completed", { ...file, status: "completed" }],
      [13, "item.completed", reasoning],
    ] as const) {
      store.getState().applyEvents([
        {
          ...eventEnvelope(sequence),
          itemId: item.id,
          payload: { item },
          timestamp: sequence === 11 ? "2026-07-28T00:00:01.000Z" : "2026-07-28T00:00:03.500Z",
          turnId: "turn-running",
          type,
        },
      ]);
    }
    expect(store.getState().turnsById["turn-running"]?.itemTimings).toEqual({
      [file.id]: {
        startedAtMs: Date.parse("2026-07-28T00:00:01.000Z"),
        completedAtMs: Date.parse("2026-07-28T00:00:03.500Z"),
      },
    });
  });
  it("records tool events before the turn completes and retains them afterward", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const item = { id: "tool-1", name: "read_file", status: "running", type: "tool" } as const;
    const startedAt = "2026-07-28T00:00:01.000Z";
    const completedAt = "2026-07-28T00:00:03.500Z";

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: item.id,
        payload: { item },
        timestamp: startedAt,
        turnId: "turn-running",
        type: "item.started",
      },
    ]);
    expect(store.getState().turnsById["turn-running"]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
    });

    store.getState().applyEvents([
      {
        ...eventEnvelope(12),
        itemId: item.id,
        payload: { item: { ...item, status: "completed" } },
        timestamp: completedAt,
        turnId: "turn-running",
        type: "item.completed",
      },
    ]);
    expect(store.getState().turnsById["turn-running"]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
      completedAtMs: Date.parse(completedAt),
    });

    const terminalTurn: AgentTurn = {
      completedAt,
      error: null,
      id: "turn-running",
      itemTimings: { [item.id]: { completedAtMs: Date.parse(completedAt) } },
      items: [{ ...item, status: "completed" }],
      startedAt: timestamp,
      status: "completed",
    };
    store.getState().applyEvents([
      {
        ...eventEnvelope(13),
        payload: { turn: terminalTurn },
        timestamp: completedAt,
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);
    expect(store.getState().reconstructSnapshot()?.turns[1]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
      completedAtMs: Date.parse(completedAt),
    });

    store.getState().reconcile({
      ...createResponse(),
      checkpoint: { sequence: 14, sessionId: "session-1" },
    });
    expect(store.getState().turnsById["turn-running"]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
      completedAtMs: Date.parse(completedAt),
    });
  });
});
