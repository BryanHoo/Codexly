import { describe, expect, it } from "vitest";
import { appendTextSequence, replaceSequenceTail, sequenceItem, type SequenceNode } from "./persistent-sequence.js";

function leaf<T>(tree: SequenceNode<T>): SequenceNode<T> {
  return tree.items !== undefined ? tree : leaf(tree.left!);
}

describe("persistent streaming sequences", () => {
  it("shares completed pages and keeps old snapshots intact across growth and replacement", () => {
    const initial = replaceSequenceTail(null, 0, Array.from({ length: 64 }, (_, i) => i))!;
    const appended = replaceSequenceTail(initial, 64, [64, 65])!;
    expect(leaf(appended)).toBe(leaf(initial));
    expect(initial.size).toBe(64);
    expect(sequenceItem(initial, 64)).toBeUndefined();
    expect(sequenceItem(appended, 65)).toBe(65);
    const replaced = replaceSequenceTail(appended, 33, [100])!;
    expect(leaf(replaced)).toBe(leaf(initial));
    expect(replaced.size).toBe(34);
    expect(sequenceItem(replaced, 33)).toBe(100);
    expect(sequenceItem(appended, 33)).toBe(33);
    expect(replaceSequenceTail(replaced, 0, [])).toBeNull();
  });

  it("bounds text pages while preserving every character", () => {
    let tree: SequenceNode<string> | null = null;
    const text = "ordinary text ".repeat(400);
    for (const character of text) tree = appendTextSequence(tree, character);
    const pages = Array.from({ length: tree!.size }, (_, index) => sequenceItem(tree, index)!);
    expect(pages.join("")).toBe(text);
    expect(Math.max(...pages.map((page) => page.length))).toBeLessThanOrEqual(1024);
  });

  it("does not split a surrogate pair across text pages", () => {
    const tree = appendTextSequence(null, "a".repeat(1023) + "😀" + "b".repeat(1024));
    expect(sequenceItem(tree, 0)).toBe("a".repeat(1023));
    expect(sequenceItem(tree, 1)?.startsWith("😀")).toBe(true);
  });
});
