import { expect, test } from "vitest";
import { usageCalendar, summarizeUsage } from "./usage-statistics-model.js";

test("aligns leap years and preserves totals without counting cached input twice", () => {
  const calendar = usageCalendar(2024);
  expect(calendar.filter(Boolean)).toHaveLength(366);
  expect(calendar[1]).toBe("2024-01-01");
  expect(calendar.filter(Boolean).at(-1)).toBe("2024-12-31");
  const summary = summarizeUsage([
    {
      day: "2024-01-01",
      engine: "codex",
      taskCount: 1,
      totalTokens: 100,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    },
  ]);
  expect(summary.totalTokens).toBe(100);
  expect(summary.cacheReadTokens).toBeNull();
  expect(summary.activeDays).toBe(1);
});
