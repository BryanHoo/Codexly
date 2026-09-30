import { parseMarkdownIntoBlocks } from "streamdown";
import { expect, it, vi } from "vitest";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import type { MarkdownBlockTree } from "@codexly/frontend-core/incremental-markdown-blocks";

import {
  createIncrementalMarkdownBlockParser,
  IncrementalMessageResponseProcessor,
} from "./message-response-processing.js";

it.each(["ordinary text ", "**bold** long paragraph text ", "- **bold** list item\n"])(
  "bounds cumulative parser input across 1,000 appends: %s",
  (delta) => {
    const parse = vi.fn(parseMarkdownIntoBlocks);
    const parser = createIncrementalMarkdownBlockParser(parse);
    const buffer = new AppendOnlyTextBuffer("");
    const processor = new IncrementalMessageResponseProcessor();
    for (let index = 0; index < 1_000; index += 1) {
      buffer.append(delta);
      parser(processor.process(buffer.getSnapshot()));
    }
    expect(Math.max(...parse.mock.calls.map(([text]) => text.length))).toBeLessThanOrEqual(8_192);
    expect(parse.mock.calls.reduce((sum, [text]) => sum + text.length, 0)).toBeLessThan(250_000);
  },
);

function contents(tree: MarkdownBlockTree): string[] {
  if (tree === null) return [];
  if (tree.items !== undefined) return tree.items.map((block) => block.content);
  return [...contents(tree.left), ...contents(tree.right)];
}

it("fully parses the unchanged final snapshot once after deferring a long complex block", () => {
  const parse = vi.fn(parseMarkdownIntoBlocks);
  const parser = createIncrementalMarkdownBlockParser(parse);
  const processor = new IncrementalMessageResponseProcessor();
  const buffer = new AppendOnlyTextBuffer("- **item**\n".repeat(2_000));
  const response = processor.process(buffer.getSnapshot());
  parser(response);
  expect(parse).not.toHaveBeenCalled();
  expect(contents(parser(response, false))).toEqual(parseMarkdownIntoBlocks(response.markdown));
  expect(parse).toHaveBeenCalledTimes(1);
  parser(response, false);
  expect(parse).toHaveBeenCalledTimes(1);
});
