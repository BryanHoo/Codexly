import { performance } from "node:perf_hooks";
import { expect, test, vi } from "vitest";
import { ClaudeTokenUsage } from "./token-usage.js";

test("keeps 100,000 token deltas free of storage work and retained request state", () => {
  const catalog = vi.fn().mockResolvedValue(undefined);
  const usage = new ClaudeTokenUsage("task", "session", { catalog }, false);
  const delta = {
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
  };
  const started = performance.now();
  for (let i = 0; i < 100_000; i += 1) usage.receive(delta, "turn");
  const elapsedMs = performance.now() - started;
  expect(catalog).not.toHaveBeenCalled();
  expect(elapsedMs).toBeLessThan(100);
  console.info(
    JSON.stringify({ metric: "token-usage-ignored-deltas", events: 100_000, elapsedMs }),
  );
});
