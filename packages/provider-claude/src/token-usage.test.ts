import { expect, test, vi } from "vitest";
import { ClaudeTokenUsage } from "./token-usage.js";

test("collects whole-tree cumulative model usage only at result boundaries", async () => {
  const catalog = vi.fn().mockResolvedValue(undefined);
  const tracker = new ClaudeTokenUsage("task", "session", { catalog }, false);
  tracker.receive({ type: "stream_event", event: { type: "content_block_delta" } }, "turn");
  expect(catalog).not.toHaveBeenCalled();
  tracker.receive(
    {
      type: "result",
      modelUsage: {
        opus: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 20,
        },
        haiku: { inputTokens: 3, outputTokens: 2 },
      },
      usage: { input_tokens: 99 },
    },
    "turn",
  );
  await tracker.flush();
  expect(catalog).toHaveBeenCalledTimes(2);
  expect(catalog).toHaveBeenNthCalledWith(
    1,
    "usage.record",
    expect.objectContaining({
      source: "session:opus",
      engine: "claude",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 30,
      cacheWriteTokens: 20,
    }),
  );
  expect(catalog).toHaveBeenNthCalledWith(
    2,
    "usage.record",
    expect.objectContaining({ outputTokens: 2, cacheReadTokens: null }),
  );
});
test("uses per-turn returned usage when whole-tree statistics are absent and isolates persistence failure", async () => {
  const catalog = vi.fn().mockRejectedValue(new Error("offline"));
  const tracker = new ClaudeTokenUsage("task", "session", { catalog }, false);
  tracker.receive({ type: "result", usage: { input_tokens: 100, output_tokens: 20 } }, "turn");
  await expect(tracker.flush()).resolves.toBeUndefined();
  expect(catalog).toHaveBeenCalledWith(
    "usage.record",
    expect.objectContaining({
      source: "session:turn:turn",
      inputTokens: 100,
      outputTokens: 20,
      cacheWriteTokens: null,
    }),
  );
});

test("ignores absent usage and isolates synchronous storage failures from successful tasks", async () => {
  const catalog = vi.fn(() => {
    throw new Error("storage unavailable");
  });
  const tracker = new ClaudeTokenUsage("task", "session", { catalog }, false);
  tracker.receive({ type: "result", subtype: "success" }, "empty");
  expect(catalog).not.toHaveBeenCalled();
  expect(() => {
    tracker.receive({ type: "result", usage: { total_tokens: 42 } }, "real");
  }).not.toThrow();
  await tracker.flush();
});
