import type { AgentItem, AgentTaskSnapshotResponse, AgentTurn } from "@/protocol/index.js";
import { expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";
import { recordToolItemTiming } from "./task-store-timing.js";

it("records file editing time without timing reasoning that has no start event", () => {
  const turn = { id: "turn-1", items: [], status: "running", startedAt: null, completedAt: null, error: null } as AgentTurn;
  const file: Extract<AgentItem, { type: "file_change" }> = {
    id: "files-1", changes: [], status: "running", type: "file_change",
  };
  const envelope = {
    itemId: file.id, turnId: turn.id, timestamp: "2026-09-26T00:00:01.000Z",
    version: 2 as const, provider: "codex", taskId: "task", sessionId: "session",
  };
  const started = recordToolItemTiming(turn, {
    ...envelope, sequence: 1, type: "item.started", payload: { item: file },
  });
  const completed = recordToolItemTiming(started, {
    ...envelope, sequence: 2, timestamp: "2026-09-26T00:00:03.500Z", type: "item.completed",
    payload: { item: { ...file, status: "completed" } },
  });
  const afterReasoning = recordToolItemTiming(completed, {
    ...envelope, sequence: 3, itemId: "reasoning-1", type: "item.completed",
    payload: { item: { id: "reasoning-1", text: "思考", type: "reasoning" } },
  });
  expect(afterReasoning.itemTimings).toEqual({
    [file.id]: {
      startedAtMs: Date.parse(envelope.timestamp),
      completedAtMs: Date.parse("2026-09-26T00:00:03.500Z"),
    },
  });
});

it("records streamed command duration before turn completion and retains it", () => {
  const startedAt = "2026-09-26T00:00:01.000Z";
  const completedAt = "2026-09-26T00:00:03.500Z";
  const command = {
    command: "pwd",
    cwd: "/workspace",
    id: "command-1",
    outputOmitted: { bytes: 0, lines: 0 },
    status: "running",
    type: "command",
  } as const;
  const turn: AgentTurn = {
    completedAt: null,
    error: null,
    id: "turn-1",
    items: [],
    startedAt,
    status: "running",
  };
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      contextUsage: null,
      goal: null,
      id: "task",
      pendingRequests: [],
      pinned: false,
      plan: null,
      projectId: "project",
      status: "running",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "model",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      title: "Task",
      turns: [turn],
      turnsNextCursor: null,
      updatedAt: startedAt,
    },
  };
  const store = createTaskStore({ projectId: "project", taskId: "task" }, response);
  const envelope = {
    version: 2,
    provider: "codex",
    taskId: "task",
    turnId: turn.id,
    sessionId: "session",
  } as const;

  store.getState().applyEvents([
    {
      ...envelope,
      itemId: command.id,
      payload: { item: command },
      sequence: 1,
      timestamp: startedAt,
      type: "item.started",
    },
  ]);
  expect(store.getState().turnsById[turn.id]?.itemTimings?.[command.id]).toEqual({
    startedAtMs: Date.parse(startedAt),
  });

  store.getState().applyEvents([
    {
      ...envelope,
      itemId: command.id,
      payload: { item: { ...command, status: "completed" } },
      sequence: 2,
      timestamp: completedAt,
      type: "item.completed",
    },
  ]);
  expect(store.getState().turnsById[turn.id]?.itemTimings?.[command.id]).toEqual({
    startedAtMs: Date.parse(startedAt),
    completedAtMs: Date.parse(completedAt),
  });

  store.getState().applyEvents([
    {
      ...envelope,
      payload: {
        turn: {
          ...turn,
          completedAt,
          itemTimings: { [command.id]: { completedAtMs: Date.parse(completedAt) } },
          items: [{ ...command, status: "completed" }],
          status: "completed",
        },
      },
      sequence: 3,
      timestamp: completedAt,
      type: "turn.completed",
    },
  ]);
  expect(store.getState().reconstructSnapshot()?.turns[0]?.itemTimings?.[command.id]).toEqual({
    startedAtMs: Date.parse(startedAt),
    completedAtMs: Date.parse(completedAt),
  });

  store.getState().reconcile({ ...response, checkpoint: { sequence: 4, sessionId: "session" } });
  expect(store.getState().turnsById[turn.id]?.itemTimings?.[command.id]).toEqual({
    startedAtMs: Date.parse(startedAt),
    completedAtMs: Date.parse(completedAt),
  });
});
