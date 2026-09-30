import { createIncrementalMarkdownBlockParser as createParser } from "@codexly/frontend-core/incremental-markdown-blocks";
import { parseMarkdownIntoBlocks } from "streamdown";
export type { MarkdownBlockTree } from "@codexly/frontend-core/incremental-markdown-blocks";
export function createIncrementalMarkdownBlockParser(parse = parseMarkdownIntoBlocks) {
  return createParser(parse);
}
