import { replaceSequenceTail, type SequenceNode } from "./persistent-sequence.js";
import {
  createMarkdownBlock,
  appendMarkdownBlock,
  deferMarkdownBlock,
  type MarkdownBlock,
} from "./streaming-markdown-block.js";
export type MarkdownBlockUpdate = Readonly<{
  markdown: string;
  comments: readonly unknown[];
  replaceFrom: number;
  replacement: string;
}>;

const FOOTNOTE_PATTERN = /\[\^[\w-]{1,200}\]/;
const MAX_STREAMING_PARSE_CHARS = 8_192;
const COMPLEX_BLOCK_CHARS = 2_048;
const COMPLEX_PARSE_INTERVAL_MS = 100;
type MarkdownBlockParser = (markdown: string) => string[];
export type MarkdownBlockTree = SequenceNode<MarkdownBlock> | null;
export type FinalMarkdownBlockParser = (
  source: string,
  signal: AbortSignal,
) => Promise<MarkdownBlock[]>;
export interface IncrementalMarkdownBlockParser {
  (response: MarkdownBlockUpdate, streaming?: boolean): MarkdownBlockTree;
  finalize: (parse: FinalMarkdownBlockParser, signal: AbortSignal) => Promise<MarkdownBlockTree>;
}

export function createIncrementalMarkdownBlockParser(
  parseBlocks: MarkdownBlockParser,
): IncrementalMarkdownBlockParser {
  let previous: MarkdownBlockUpdate | undefined;
  let previousStreaming = true;
  let lastParsedAt = -Infinity;
  let lastParsedLength = 0;
  let tree: MarkdownBlockTree = null;
  const blocks: MarkdownBlock[] = [];
  const blockEnds: number[] = [];
  let revision = 0;

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

  function settleTail(): MarkdownBlockTree {
    const last = blocks.at(-1);
    if (last?.kind === "code") {
      // 未闭合代码只在收尾时交还完整渲染器，稳定文本块仍保留原来的分页树。
      commit(blocks.length - 1, blockEnds.at(-2) ?? 0, [
        { kind: "markdown", content: last.content, source: last.source },
      ]);
    } else if (last?.kind === "deferred" && last.source.length <= MAX_STREAMING_PARSE_CHARS) {
      const global = FOOTNOTE_PATTERN.test(last.source);
      if (global && (previous?.markdown.length ?? 0) > MAX_STREAMING_PARSE_CHARS) {
        const source = previous?.markdown ?? last.source;
        commit(0, 0, [deferMarkdownBlock(undefined, source, 0, source)]);
        return tree;
      }
      const stableCount = global ? 0 : blocks.length - 1;
      commit(
        stableCount,
        blockEnds[stableCount - 1] ?? 0,
        parseFinalMarkdownBlocks(
          global ? (previous?.markdown ?? last.source) : last.source,
          parseBlocks,
        ),
      );
    }
    return tree;
  }

  const update = (response: MarkdownBlockUpdate, streaming = true): MarkdownBlockTree => {
    if (response === previous && streaming === previousStreaming) return tree;
    revision += 1;
    previousStreaming = streaming;
    // 完成事件经常复用最后的快照；不能再次应用该快照的增量，也不能重建历史块。
    if (response === previous) return streaming ? tree : settleTail();
    const { replaceFrom, replacement } = response;
    const last = blocks.at(-1);
    const appended =
      replaceFrom > 0 && replaceFrom === previous?.markdown.length && last !== undefined
        ? appendMarkdownBlock(last, replacement)
        : null;
    if (appended !== null) {
      blocks[blocks.length - 1] = appended;
      blockEnds[blockEnds.length - 1] = response.markdown.length;
      tree = replaceSequenceTail(tree, blocks.length - 1, [appended]);
      previous = response;
      return streaming ? tree : settleTail();
    }

    // 二分定位变更边界，再回退一块以处理 Setext 标题、列表等跨块语法。
    let low = 0;
    let high = blockEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((blockEnds[middle] ?? 0) <= replaceFrom) low = middle + 1;
      else high = middle;
    }
    // 已延迟的尾块已经包含回退上下文，不能每次追加再吞并一个稳定历史块。
    const deferredStart = last?.kind === "deferred" ? (blockEnds.at(-2) ?? 0) : undefined;
    const stableCount =
      deferredStart !== undefined && replaceFrom >= deferredStart
        ? blocks.length - 1
        : Math.max(0, low - 1);
    const stableLength = blockEnds[stableCount - 1] ?? 0;
    const tailLength = response.markdown.length - stableLength;
    const now = performance.now();
    const complex = last?.kind === "markdown" || last?.kind === "deferred";
    const defer =
      tailLength > MAX_STREAMING_PARSE_CHARS ||
      (streaming &&
        complex &&
        tailLength > COMPLEX_BLOCK_CHARS &&
        replaceFrom > 0 &&
        (now - lastParsedAt < COMPLEX_PARSE_INTERVAL_MS || tailLength < lastParsedLength * 1.5));
    if (defer) {
      // 预算判断先于拼接、脚注扫描和 lexer；追加路径只读取新增片段。
      const existing = stableCount === blocks.length - 1 ? last : undefined;
      const source =
        existing !== undefined && replaceFrom === previous?.markdown.length
          ? existing.source + replacement
          : response.markdown.slice(stableLength);
      commit(stableCount, stableLength, [
        deferMarkdownBlock(existing, source, replaceFrom - stableLength, replacement),
      ]);
      previous = response;
      return tree;
    }
    let retainedTail = "";
    let remaining = replaceFrom - stableLength;
    for (let index = stableCount; remaining > 0 && index < blocks.length; index += 1) {
      const block = blocks[index]?.source ?? "";
      retainedTail += block.slice(0, remaining);
      remaining -= block.length;
    }
    const tail = retainedTail + replacement;
    if (FOOTNOTE_PATTERN.test(tail)) {
      // 脚注保留全文作用域，只有普通块进入独立渲染路径。
      commit(0, 0, [
        response.markdown.length > MAX_STREAMING_PARSE_CHARS
          ? deferMarkdownBlock(undefined, response.markdown, 0, response.markdown)
          : { kind: "markdown", content: response.markdown, source: response.markdown },
      ]);
    } else {
      const tailBlocks = parseBlocks(tail);
      const tailSources = tail.includes("\r\n")
        ? restoreSourceBlocks(tail, tailBlocks)
        : tailBlocks;
      const additions = tailBlocks.map((content, index) =>
        createMarkdownBlock(content, tailSources[index] ?? content),
      );
      // 私有目录原位截断；React 只接收不可变的共享树，不复制历史数组。
      commit(stableCount, stableLength, additions);
    }
    lastParsedAt = now;
    lastParsedLength = tailLength;
    previous = response;
    return streaming ? tree : settleTail();
  };

  return Object.assign(update, {
    async finalize(
      parse: FinalMarkdownBlockParser,
      signal: AbortSignal,
    ): Promise<MarkdownBlockTree> {
      const last = blocks.at(-1);
      if (previousStreaming || last?.kind !== "deferred" || signal.aborted) return tree;
      const version = revision;
      // 大尾块的 lexer 和分块对象构建由调用方移到 Worker；脚注仍保留全文作用域。
      const global = FOOTNOTE_PATTERN.test(last.source);
      const stableCount = global ? 0 : blocks.length - 1;
      const stableLength = blockEnds[stableCount - 1] ?? 0;
      const additions = await parse(
        global ? (previous?.markdown ?? last.source) : last.source,
        signal,
      );
      // 替换正文、恢复流式或卸载时，迟到结果不得覆盖较新的树。
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- await 期间 AbortSignal 可由调用方取消。
      if (!signal.aborted && version === revision) commit(stableCount, stableLength, additions);
      return tree;
    },
  });
}

function settledBlock(content: string, source: string): MarkdownBlock {
  const block = createMarkdownBlock(content, source);
  return block.kind === "code" ? { kind: "markdown", content, source } : block;
}

export function parseFinalMarkdownBlocks(
  source: string,
  parse: MarkdownBlockParser,
): MarkdownBlock[] {
  const parsed = FOOTNOTE_PATTERN.test(source) ? [source] : parse(source);
  const sources = source.includes("\r\n") ? restoreSourceBlocks(source, parsed) : parsed;
  return parsed.map((content, index) => settledBlock(content, sources[index] ?? content));
}

function restoreSourceBlocks(source: string, blocks: readonly string[]): string[] {
  let offset = 0;
  return blocks.map((block) => {
    const start = offset;
    for (let remaining = block.length; remaining > 0; remaining -= 1) {
      if (source[offset] === "\r" && source[offset + 1] === "\n") offset += 1;
      offset += 1;
    }
    return source.slice(start, offset);
  });
}
