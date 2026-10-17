import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentContextUsage } from "@codexly/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { refreshClaudeContext } from "./observability.js";

type ContextSummary = Awaited<ReturnType<Query["getContextUsage"]>>;
const summary = { totalTokens: 123, rawMaxTokens: 200000 } as ContextSummary;

afterEach(() => vi.useRealTimers());

function harness() {
  const pending = Promise.withResolvers<ContextSummary>();
  const readContext = vi.fn(() => pending.promise);
  const query = { getContextUsage: readContext } as unknown as Query;
  const projection = {
    status: "running",
    changes: { revision: 0 },
    contextUsage: null as AgentContextUsage | null,
    updateContextUsage: vi.fn((usage: AgentContextUsage) => {
      projection.contextUsage = usage;
    }),
  };
  return { pending, query, projection, readContext };
}

it.each(["revision", "usage"])(
  "ignores context summaries superseded by a newer %s",
  async (change) => {
    const h = harness();
    const refreshing = refreshClaudeContext(h.query, h.projection);
    if (change === "revision") h.projection.changes.revision++;
    else h.projection.contextUsage = { usedTokens: 456, contextWindow: null };
    h.pending.resolve(summary);
    await refreshing;
    expect(h.projection.updateContextUsage).not.toHaveBeenCalled();
  },
);

it("keeps timed-out uncancellable context requests single-flight until the SDK settles", async () => {
  vi.useFakeTimers();
  const h = harness();
  try {
    const first = refreshClaudeContext(h.query, h.projection);
    const concurrent = refreshClaudeContext(h.query, h.projection);
    expect(h.readContext).toHaveBeenCalledTimes(1);
    await concurrent;
    await vi.advanceTimersByTimeAsync(1500);
    await first;
    const second = refreshClaudeContext(h.query, h.projection);
    expect(h.readContext).toHaveBeenCalledTimes(1);
    await second;
    h.pending.resolve(summary);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.projection.updateContextUsage).not.toHaveBeenCalled();
    // 真正结束后允许新请求；无需积压或自动重试已过期的回合。
    await refreshClaudeContext(h.query, h.projection);
    expect(h.readContext).toHaveBeenCalledTimes(2);
    expect(h.projection.contextUsage).toEqual({ usedTokens: 123, contextWindow: 200000 });
  } finally {
    h.pending.resolve(summary);
  }
});

it("releases the context request slot after SDK rejection", async () => {
  const h = harness();
  const refreshing = refreshClaudeContext(h.query, h.projection);
  h.pending.reject(new Error("统计暂不可用"));
  await refreshing;
  h.readContext.mockResolvedValue(summary);
  await refreshClaudeContext(h.query, h.projection);
  expect(h.readContext).toHaveBeenCalledTimes(2);
  expect(h.projection.contextUsage).toEqual({ usedTokens: 123, contextWindow: 200000 });
});
