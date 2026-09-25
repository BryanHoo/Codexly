import { parseMarkdownIntoBlocks } from "streamdown";
import { replaceSequenceTail, type SequenceNode } from "../../lib/persistent-sequence.js";
import { createMarkdownBlock, appendMarkdownBlock, deferMarkdownBlock, type MarkdownBlock } from "./streaming-markdown-block.js";
import type { ProcessedMessageResponse } from "./message-response-processing.js";

const FOOTNOTE_PATTERN = /\[\^[\w-]{1,200}\]/;
const MAX_STREAMING_PARSE_CHARS = 8_192;
const COMPLEX_BLOCK_CHARS = 2_048;
const COMPLEX_PARSE_INTERVAL_MS = 100;
type MarkdownBlockParser = (markdown: string) => string[];
export type MarkdownBlockTree = SequenceNode<MarkdownBlock> | null;

export function createIncrementalMarkdownBlockParser(
  parseBlocks: MarkdownBlockParser = parseMarkdownIntoBlocks,
): (response: ProcessedMessageResponse, streaming?: boolean) => MarkdownBlockTree {
  let previous: ProcessedMessageResponse | undefined;
  let previousStreaming = true;
  let lastParsedAt = -Infinity;
  let lastParsedLength = 0;
  let tree: MarkdownBlockTree = null;
  const blocks: MarkdownBlock[] = [];
  const blockEnds: number[] = [];

  function commit(stableCount: number, stableLength: number, additions: MarkdownBlock[]): void {
    blocks.length = stableCount;
    blockEnds.length = stableCount;
    let end = stableLength;
    for (const block of additions) {
      blocks.push(block);
      end += block.source.length;
      blockEnds.push(end);
    }
    tree = replaceSequenceTail(tree, stableCount, additions);
  }

  return (response, streaming = true) => {
    if (response === previous && streaming === previousStreaming) return tree;
    previousStreaming = streaming;
    if (!streaming) {
      // 状态变化也必须刷新；结束时可能复用最后一个 Chunk 快照，没有新的正文增量。
      const content = response.markdown;
      const parsed = FOOTNOTE_PATTERN.test(content) ? [content] : parseBlocks(content);
      const sources = content.includes("\r\n") ? restoreSourceBlocks(content, parsed) : parsed;
      commit(0, 0, parsed.map((block, index) => createMarkdownBlock(block, sources[index]!)));
      previous = response;
      return tree;
    }
    const { replaceFrom, replacement } = response;
    const last = blocks.at(-1);
    const appended = replaceFrom > 0 && replaceFrom === previous?.markdown.length && last !== undefined
      ? appendMarkdownBlock(last, replacement) : null;
    if (appended !== null) {
      blocks[blocks.length - 1] = appended;
      blockEnds[blockEnds.length - 1] = response.markdown.length;
      tree = replaceSequenceTail(tree, blocks.length - 1, [appended]);
      previous = response;
      return tree;
    }

    // 二分定位变更边界，再回退一块以处理 Setext 标题、列表等跨块语法。
    let low = 0;
    let high = blockEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (blockEnds[middle]! <= replaceFrom) low = middle + 1;
      else high = middle;
    }
    // 已延迟的尾块已经包含回退上下文，不能每次追加再吞并一个稳定历史块。
    const deferredStart = last?.kind === "deferred" ? (blockEnds.at(-2) ?? 0) : undefined;
    const stableCount = deferredStart !== undefined && replaceFrom >= deferredStart
      ? blocks.length - 1 : Math.max(0, low - 1);
    const stableLength = blockEnds[stableCount - 1] ?? 0;
    const tailLength = response.markdown.length - stableLength;
    const now = performance.now();
    const complex = last?.kind === "markdown" || last?.kind === "deferred";
    const defer = tailLength > MAX_STREAMING_PARSE_CHARS ||
      (complex && tailLength > COMPLEX_BLOCK_CHARS && replaceFrom > 0 &&
        (now - lastParsedAt < COMPLEX_PARSE_INTERVAL_MS || tailLength < lastParsedLength * 1.5));
    if (defer) {
      // 预算判断先于拼接、脚注扫描和 lexer；追加路径只读取新增片段。
      const existing = stableCount === blocks.length - 1 ? last : undefined;
      const source = existing !== undefined && replaceFrom === previous?.markdown.length
        ? existing.source + replacement : response.markdown.slice(stableLength);
      commit(stableCount, stableLength, [deferMarkdownBlock(existing, source, replaceFrom - stableLength, replacement)]);
      previous = response;
      return tree;
    }
    let retainedTail = "";
    let remaining = replaceFrom - stableLength;
    for (let index = stableCount; remaining > 0 && index < blocks.length; index += 1) {
      const block = blocks[index]!.source;
      retainedTail += block.slice(0, remaining);
      remaining -= block.length;
    }
    const tail = retainedTail + replacement;
    if (FOOTNOTE_PATTERN.test(tail)) {
      // 脚注保留全文作用域，只有普通块进入独立渲染路径。
      blocks.length = 0;
      blocks.push({ kind: "markdown", content: response.markdown, source: response.markdown });
      blockEnds.length = 0;
      blockEnds.push(response.markdown.length);
      tree = replaceSequenceTail(tree, 0, blocks);
    } else {
      const tailBlocks = parseBlocks(tail);
      const tailSources = tail.includes("\r\n") ? restoreSourceBlocks(tail, tailBlocks) : tailBlocks;
      const additions = tailBlocks.map((content, index) => createMarkdownBlock(content, tailSources[index]!));
      // 私有目录原位截断；React 只接收不可变的共享树，不复制历史数组。
      commit(stableCount, stableLength, additions);
    }
    lastParsedAt = now;
    lastParsedLength = tailLength;
    previous = response;
    return tree;
  };
}

function restoreSourceBlocks(source: string, blocks: readonly string[]): string[] {
  let offset = 0;
  return blocks.map((block) => {
    const start = offset;
    for (let index = 0; index < block.length; index += 1) {
      if (source[offset] === "\r" && source[offset + 1] === "\n") offset += 1;
      offset += 1;
    }
    return source.slice(start, offset);
  });
}
