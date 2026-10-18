import { expect, it } from "vitest";
import { searchEngineFilter } from "./search-engines.js";

it("uses the enabled dependency set with a stable dual-engine query identity", () => {
  expect(searchEngineFilter(["claude"])).toBe("claude");
  expect(searchEngineFilter(["codex"])).toBe("codex");
  expect(searchEngineFilter(["claude", "codex"])).toBe(searchEngineFilter(["codex", "claude"]));
  expect(searchEngineFilter(undefined)).toBeUndefined();
});
