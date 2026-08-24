import { describe, expect, it, vi } from "vitest";

import { ByteLru, estimateRetainedBytes, getUtf8ByteLength } from "./byte-lru.js";

describe("ByteLru", () => {
  it("evicts the least recently used entries by retained bytes", () => {
    const cache = new ByteLru<string, string>({
      getRetainedBytes: (_key, value) => getUtf8ByteLength(value),
      maxBytes: 6,
    });

    cache.set("first", "一");
    cache.set("second", "二");
    expect(cache.get("first")).toBe("一");

    cache.set("third", "三");

    expect(cache.peek("first")).toBe("一");
    expect(cache.peek("second")).toBeUndefined();
    expect(cache.peek("third")).toBe("三");
    expect(cache.retainedBytes).toBe(6);
  });

  it("rejects an entry larger than the entire budget", () => {
    const onEvict = vi.fn();
    const cache = new ByteLru<string, string>({
      getRetainedBytes: (_key, value) => value.length,
      maxBytes: 3,
      onEvict,
    });

    expect(cache.set("oversized", "large")).toBe(false);
    expect(cache.size).toBe(0);
    expect(onEvict).not.toHaveBeenCalled();
  });
});

describe("estimateRetainedBytes", () => {
  it("counts UTF-8 strings and shared object references without recursion loops", () => {
    const sharedValue = { text: "中文" };
    const value = { first: sharedValue, second: sharedValue };

    expect(getUtf8ByteLength("中文")).toBe(6);
    expect(estimateRetainedBytes(value)).toBeGreaterThan(6);
  });
});
