import { afterEach, expect, test, vi } from "vitest";
import { readQuestionDismissals, saveQuestionDismissals } from "./async-question-dismissals.js";

afterEach(() => vi.unstubAllGlobals());

test("persists dismissals per task and merges later closures", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  saveQuestionDismissals("task-a", new Set(["turn-1:question-1"]));
  saveQuestionDismissals("task-a", new Set(["turn-2:question-2"]));
  expect([...readQuestionDismissals("task-a")]).toEqual(["turn-1:question-1", "turn-2:question-2"]);
  expect(readQuestionDismissals("task-b").size).toBe(0);
  expect(readQuestionDismissals("task-a").has("turn-3:question-3")).toBe(false);
});

test.each(["invalid json", "{}", '["question-1", 1]'])("ignores invalid storage: %s", (value) => {
  vi.stubGlobal("localStorage", { getItem: () => value });
  expect(readQuestionDismissals("task-a").size).toBe(0);
});

test("keeps the local dismissal when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Storage unavailable");
    },
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  expect([...saveQuestionDismissals("task-a", new Set(["question-1"]))]).toEqual(["question-1"]);
});
