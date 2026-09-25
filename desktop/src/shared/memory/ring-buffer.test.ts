import { describe, expect, it } from "vitest";

import { RingBuffer } from "./ring-buffer.js";

describe("RingBuffer", () => {
  it("overwrites the oldest entry and preserves iteration order", () => {
    const buffer = new RingBuffer<number>(3);

    expect(buffer.append(1)).toBeUndefined();
    buffer.append(2);
    buffer.append(3);
    expect(buffer.append(4)).toBe(1);

    const values: number[] = [];
    buffer.forEach((value) => values.push(value));
    expect(values).toEqual([2, 3, 4]);
  });

  it("evicts the oldest entry in constant time", () => {
    const buffer = new RingBuffer<number>(2);
    buffer.append(1);
    buffer.append(2);

    expect(buffer.evictOldest()).toBe(1);
    expect(buffer.evictOldest()).toBe(2);
    expect(buffer.evictOldest()).toBeUndefined();
  });
});
