import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, expect, it, vi } from "vitest";
import { refreshClaudeMcpSnapshot, type ClaudeMcpSnapshot } from "./mcp.js";

afterEach(() => vi.useRealTimers());

it("bounds pending MCP observations and prevents timed-out replies from refreshing the cache", async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<Awaited<ReturnType<Query["mcpServerStatus"]>>>();
  const mcpServerStatus = vi.fn(() => pending.promise);
  const query = { mcpServerStatus } as unknown as Query;
  const snapshot: ClaudeMcpSnapshot = { mcpServers: [], mcpObservedAt: "old" };
  const observations = Array.from({ length: 8 }, () =>
    refreshClaudeMcpSnapshot(query, snapshot, () => true),
  );
  await vi.advanceTimersByTimeAsync(1500);
  expect(await Promise.all(observations)).toEqual(Array(8).fill(false));
  expect(mcpServerStatus).toHaveBeenCalledTimes(1);
  expect(snapshot.mcpObservedAt).toBe("old");
  pending.resolve([{ name: "late", status: "connected" }]);
  await Promise.resolve();
  expect(snapshot.mcpServers).toEqual([]);
});

it("discards an observation if its Query is disposed while the request is pending", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<Query["mcpServerStatus"]>>>();
  const query = { mcpServerStatus: () => pending.promise } as unknown as Query;
  const snapshot: ClaudeMcpSnapshot = { mcpServers: [], mcpObservedAt: "old" };
  let current = true;
  const result = refreshClaudeMcpSnapshot(query, snapshot, () => current);
  current = false;
  pending.resolve([{ name: "late", status: "connected" }]);
  expect(await result).toBe(false);
  expect(snapshot.mcpObservedAt).toBe("old");
});
