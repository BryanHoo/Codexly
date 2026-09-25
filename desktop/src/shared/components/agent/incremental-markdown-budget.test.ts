import { parseMarkdownIntoBlocks } from "streamdown";
import { expect, it, vi } from "vitest";
import { createIncrementalMarkdownBlockParser, type MarkdownBlockTree } from "./incremental-markdown-blocks.js";
import type { ProcessedMessageResponse } from "./message-response-processing.js";
import type { SequenceNode } from "../../lib/persistent-sequence.js";
import type { MarkdownBlock } from "./streaming-markdown-block.js";

function flatten<T>(tree: SequenceNode<T> | null): T[] {
  if (tree === null) return [];
  if (tree.items !== undefined) return [...tree.items];
  return [...flatten(tree.left), ...flatten(tree.right)];
}

function preview(block: MarkdownBlock): string {
  return block.content + (block.kind === "deferred" ? flatten(block.text).join("") : "");
}

function contents(tree: MarkdownBlockTree): string[] {
  if (tree === null) return [];
  if (tree.items !== undefined) return tree.items.map((block) => block.content);
  return [...contents(tree.left), ...contents(tree.right)];
}

it.each(["**bold** long paragraph text ", "- **bold** list item\n"])(
  "bounds cumulative production parser work for %s and flushes unchanged final input",
  (delta) => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const parser = createIncrementalMarkdownBlockParser(parse);
    let response: ProcessedMessageResponse = { markdown: "", comments: [], replaceFrom: 0, replacement: "" };
    try {
      for (let index = 0; index < 1_000; index += 1) {
        now += 16;
        response = { markdown: response.markdown + delta, comments: [], replaceFrom: response.markdown.length, replacement: delta };
        parser(response);
      }
      expect(Math.max(...parse.mock.calls.map(([text]) => text.length))).toBeLessThanOrEqual(8_192);
      expect(parse.mock.calls.reduce((sum, [text]) => sum + text.length, 0)).toBeLessThan(250_000);
      expect(contents(parser(response, false))).toEqual(parseMarkdownIntoBlocks(response.markdown));
      const calls = parse.mock.calls.length;
      parser(response, false);
      expect(parse).toHaveBeenCalledTimes(calls);
    } finally {
      clock.mockRestore();
    }
  },
);

it("requires both the time and growth budgets before parsing a complex tail again", () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const parse = vi.fn(parseMarkdownIntoBlocks);
  const parser = createIncrementalMarkdownBlockParser(parse);
  let response: ProcessedMessageResponse = { markdown: "**bold** ".repeat(240), comments: [], replaceFrom: 0, replacement: "**bold** ".repeat(240) };
  const append = (delta: string) => {
    response = { markdown: response.markdown + delta, comments: [], replaceFrom: response.markdown.length, replacement: delta };
    return parser(response);
  };
  try {
    parser(response);
    now = 99;
    const deferred = append("more **bold** ".repeat(100));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(flatten(deferred).map(preview).join("")).toBe(response.markdown);
    now = 100;
    append("next");
    expect(parse).toHaveBeenCalledTimes(2);
    now = 1_000;
    append("small");
    expect(parse).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

it.each(["\r\n- **item** 😀", " text[^note]"])("preserves deferred source through edits, replay and finalization: %s", (delta) => {
  const parser = createIncrementalMarkdownBlockParser();
  const source = delta.repeat(1_000);
  const initial = { markdown: source, replacement: source, replaceFrom: 0, comments: [] };
  expect(flatten(parser(initial)).map(preview).join("")).toBe(source);
  const edited = { markdown: source.slice(0, -4) + "changed", replacement: "changed", replaceFrom: source.length - 4, comments: [] };
  expect(flatten(parser(edited)).map(preview).join("")).toBe(edited.markdown);
  expect(flatten(parser(initial)).map(preview).join("")).toBe(source);
  const final = contents(parser(initial, false));
  expect(final).toEqual(source.includes("[^note]") ? [source] : parseMarkdownIntoBlocks(source));
  expect(contents(parser({ markdown: "new", replacement: "new", replaceFrom: 0, comments: [] }))).toEqual(["new"]);
});
