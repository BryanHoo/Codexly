import { describe, expect, it } from "vitest";

import { CodeTokenCache, type TokenizedCode } from "./code-token-cache.js";

const language = "typescript" as const;

function createTokenizedCode(content: string): TokenizedCode {
  return {
    background: "transparent",
    foreground: "inherit",
    lines: [[{ content, offset: 0 }]],
  };
}

describe("CodeTokenCache", () => {
  it("uses byte LRU eviction instead of retaining every source forever", () => {
    const cache = new CodeTokenCache(10_000, 2, 100);
    const first = createTokenizedCode("first");

    cache.set(language, "first", first);
    cache.set(language, "second", createTokenizedCode("second"));
    expect(cache.get(language, "first")).toBe(first);

    cache.set(language, "third", createTokenizedCode("third"));

    expect(cache.get(language, "first")).toBe(first);
    expect(cache.get(language, "second")).toBeUndefined();
    expect(cache.get(language, "third")).toBeDefined();
  });

  it("does not admit source text larger than the source budget", () => {
    const cache = new CodeTokenCache(1_000, 10, 3);

    expect(cache.set(language, "中文", createTokenizedCode("中文"))).toBe(false);
    expect(cache.size).toBe(0);
  });
});
