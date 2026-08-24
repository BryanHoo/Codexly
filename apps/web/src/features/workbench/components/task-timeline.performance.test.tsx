import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import performanceBudgets from "../../../../../../tests/performance-budgets.json" with { type: "json" };
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskTimeline } from "./task-timeline.js";

const timestamp = "2026-08-02T00:00:00.000Z";

function createLongHistory(): RuntimeTaskSnapshot {
  const { items, itemsPerTurn } = performanceBudgets.longHistory;
  const turnCount = items / itemsPerTurn;

  return {
    contextUsage: null,
    plan: null,
    id: "task-performance-history",
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
    status: "idle",
    title: "10,000 Item performance history",
    turns: Array.from({ length: turnCount }, (_, turnIndex) => ({
      completedAt: timestamp,
      error: null,
      id: `turn-${String(turnIndex)}`,
      items: Array.from({ length: itemsPerTurn }, (_, itemIndex) => ({
        id: `message-${String(turnIndex)}-${String(itemIndex)}`,
        role: itemIndex % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `固定历史内容 ${String(turnIndex)}:${String(itemIndex)}`,
        type: "message" as const,
      })),
      startedAt: timestamp,
      status: "completed" as const,
    })),
    turnsNextCursor: null,
    updatedAt: timestamp,
  };
}

describe("TaskTimeline performance", () => {
  it("normalizes and virtualizes a deterministic 10,000 Item history within budget", () => {
    const snapshot = createLongHistory();
    const response = {
      checkpoint: { sequence: 0, sessionId: "session-performance" },
      snapshot,
    };

    const hydrationStartedAt = performance.now();
    const store = createTaskStore({ projectId: snapshot.projectId, taskId: snapshot.id }, response);
    const hydrationDurationMs = performance.now() - hydrationStartedAt;

    const renderStartedAt = performance.now();
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <TaskTimeline
          projectId={snapshot.projectId}
          runtime={{
            connectionState: "connected",
            error: null,
            hasOlderHistory: false,
            isLoadingOlderHistory: false,
            isPending: false,
            loadOlderHistory: () => Promise.resolve(),
            olderHistoryError: null,
            snapshot,
            store,
          }}
          taskId={snapshot.id}
        />
      </TooltipProvider>,
    );
    const renderDurationMs = performance.now() - renderStartedAt;

    const state = store.getState();
    const mountedTurns = markup.match(/aria-label="Turn /gu)?.length ?? 0;
    // 规模断言限制算法和 DOM 复杂度，墙钟阈值只负责捕获明显性能回退。
    expect(state.itemStoresByKey.size).toBe(performanceBudgets.longHistory.items);
    expect(state.turnIds).toHaveLength(
      performanceBudgets.longHistory.items / performanceBudgets.longHistory.itemsPerTurn,
    );
    expect(mountedTurns).toBeGreaterThan(0);
    expect(mountedTurns).toBeLessThanOrEqual(performanceBudgets.longHistory.maxMountedTurns);
    expect(new TextEncoder().encode(markup).byteLength).toBeLessThanOrEqual(
      performanceBudgets.longHistory.maxMarkupBytes,
    );
    expect(hydrationDurationMs).toBeLessThan(performanceBudgets.longHistory.maxHydrationMs);
    expect(renderDurationMs).toBeLessThan(performanceBudgets.longHistory.maxRenderMs);
  });
});
