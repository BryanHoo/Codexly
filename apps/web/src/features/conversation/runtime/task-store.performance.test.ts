/// <reference types="node" />

import { memoryUsage } from "node:process";

import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import performanceBudgets from "../../../../../../tests/performance-budgets.json" with { type: "json" };
import { createTaskItemKey, createTaskStore } from "./task-store.js";

const timestamp = "2026-08-02T00:00:00.000Z";

function createResponse(taskId = "task-performance"): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 0, sessionId: "session-performance" },
    snapshot: {
      contextUsage: null,
      goal: null,
      plan: null,
      id: taskId,
      pendingRequests: [],
      pinned: false,
      projectId: "project-performance",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "running",
      title: "Delta performance",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-performance",
          items: [
            {
              id: "message-performance",
              role: "assistant",
              text: "",
              type: "message",
            },
          ],
          startedAt: timestamp,
          status: "running",
        },
      ],
      turnsNextCursor: null,
      updatedAt: timestamp,
    },
  };
}

function createDeltaEvents(taskId: string, count: number): AgentEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: "message-performance",
    payload: { delta: "x" },
    provider: "codex",
    sequence: index + 1,
    sessionId: "session-performance",
    taskId,
    timestamp,
    turnId: "turn-performance",
    type: "message.delta" as const,
    version: 2 as const,
  }));
}

function createCommandDeltaEvents(taskId: string, count: number): AgentEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: "command-performance",
    payload: { delta: "x" },
    provider: "codex",
    sequence: index + 1,
    sessionId: "session-performance",
    taskId,
    timestamp,
    turnId: "turn-performance",
    type: "command.output_delta" as const,
    version: 2 as const,
  }));
}

function createLongHistoryResponse(): AgentTaskSnapshotResponse {
  const { items, itemsPerTurn } = performanceBudgets.longHistory;
  const turnCount = items / itemsPerTurn;
  const response = createResponse("task-long-history");
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      turns: Array.from({ length: turnCount }, (_, turnIndex) => ({
        completedAt: turnIndex === turnCount - 1 ? null : timestamp,
        error: null,
        id: `turn-${String(turnIndex)}`,
        items: Array.from({ length: itemsPerTurn }, (_, itemIndex) => ({
          id: `message-${String(turnIndex)}-${String(itemIndex)}`,
          role: "assistant" as const,
          text: "历史消息",
          type: "message" as const,
        })),
        startedAt: timestamp,
        status: turnIndex === turnCount - 1 ? ("running" as const) : ("completed" as const),
      })),
    },
  };
}

function collectHeap(): number {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (gc === undefined) {
    throw new Error("Performance tests require explicit GC");
  }
  gc();
  gc();
  return memoryUsage().heapUsed;
}

function exerciseStoreLifecycle(iteration: number, deltaCount: number): void {
  const taskId = `task-heap-${String(iteration)}`;
  const store = createTaskStore(
    { projectId: "project-performance", taskId },
    createResponse(taskId),
  );
  store.getState().applyEvents(createDeltaEvents(taskId, deltaCount));
  expect(store.getState().getItem("message-performance", "turn-performance")).toMatchObject({
    text: "x".repeat(deltaCount),
  });
}

describe("TaskStore performance", () => {
  it("completes the active turn in a 10,000 Item history within budget", () => {
    const response = createLongHistoryResponse();
    const store = createTaskStore(
      { projectId: response.snapshot.projectId, taskId: response.snapshot.id },
      response,
    );
    const activeTurn = response.snapshot.turns.at(-1);
    if (activeTurn === undefined) {
      throw new Error("Expected a long-history active turn");
    }
    const startedAt = performance.now();

    store.getState().applyEvents([
      {
        payload: {
          turn: {
            ...activeTurn,
            completedAt: timestamp,
            status: "completed",
          },
        },
        provider: "codex",
        sequence: 1,
        sessionId: "session-performance",
        taskId: response.snapshot.id,
        timestamp,
        turnId: activeTurn.id,
        type: "turn.completed",
        version: 2,
      },
    ]);
    const durationMs = performance.now() - startedAt;

    expect(store.getState().reconstructSnapshot()?.turns.at(-1)?.status).toBe("completed");
    expect(durationMs).toBeLessThan(performanceBudgets.longHistory.maxTurnCompletionMs);
  });

  it("replays 50,000 deltas with one Item notification within budget", () => {
    const response = createResponse();
    const store = createTaskStore(
      { projectId: "project-performance", taskId: response.snapshot.id },
      response,
    );
    const itemStore = store
      .getState()
      .itemStoresByKey.get(createTaskItemKey("turn-performance", "message-performance"));
    if (itemStore === undefined) {
      throw new Error("Expected the performance message item store");
    }
    const listener = vi.fn();
    const unsubscribe = itemStore.subscribe(listener);
    const events = createDeltaEvents(response.snapshot.id, performanceBudgets.delta.clientEvents);

    const startedAt = performance.now();
    store.getState().applyEvents(events);
    const durationMs = performance.now() - startedAt;
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getState().getItem("message-performance", "turn-performance")).toMatchObject({
      text: "x".repeat(performanceBudgets.delta.clientEvents),
    });
    expect(durationMs).toBeLessThan(performanceBudgets.delta.maxClientReplayMs);
  });

  it("replays 50,000 command deltas without materializing accumulated output", () => {
    const response = createResponse("task-command-performance");
    const activeTurn = response.snapshot.turns[0];
    if (activeTurn === undefined) {
      throw new Error("Expected the performance turn");
    }
    const commandResponse: AgentTaskSnapshotResponse = {
      ...response,
      snapshot: {
        ...response.snapshot,
        turns: [
          {
            ...activeTurn,
            items: [
              {
                command: "stream-output",
                cwd: "/workspace",
                id: "command-performance",
                output: "",
                outputTruncated: false,
                status: "running",
                type: "command",
              },
            ],
          },
        ],
      },
    };
    const store = createTaskStore(
      { projectId: commandResponse.snapshot.projectId, taskId: commandResponse.snapshot.id },
      commandResponse,
    );
    const itemStore = store
      .getState()
      .itemStoresByKey.get(createTaskItemKey("turn-performance", "command-performance"));
    if (itemStore === undefined) {
      throw new Error("Expected the performance command item store");
    }
    const readSpy = vi.spyOn(itemStore, "read");
    const events = createCommandDeltaEvents(
      commandResponse.snapshot.id,
      performanceBudgets.delta.clientEvents,
    );

    const startedAt = performance.now();
    store.getState().applyEvents(events);
    const durationMs = performance.now() - startedAt;

    expect(readSpy).not.toHaveBeenCalled();
    expect(itemStore.readCommandOutput()).toMatchObject({
      outputBytes: performanceBudgets.delta.clientEvents,
      outputTruncated: false,
    });
    expect(durationMs).toBeLessThan(performanceBudgets.delta.maxClientReplayMs);
  });

  it("releases repeated Store lifecycles without sustained Heap growth", () => {
    const { deltasPerIteration, iterations, maxGrowthBytes } = performanceBudgets.heap;
    // 先预热转换器和 JIT，避免一次性初始化被误判为生命周期泄漏。
    for (let iteration = 0; iteration < 5; iteration += 1) {
      exerciseStoreLifecycle(iteration, deltasPerIteration);
    }
    const heapBefore = collectHeap();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      exerciseStoreLifecycle(iteration + 5, deltasPerIteration);
    }

    const heapGrowth = collectHeap() - heapBefore;
    expect(heapGrowth).toBeLessThanOrEqual(maxGrowthBytes);
  });
});
