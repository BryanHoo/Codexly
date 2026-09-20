import { parseMarkdownIntoBlocks } from "streamdown";

import {
  parseCodeCommentDirective,
  parseCodeComments,
  type CodeComment,
  type ParsedCodeComments,
} from "./code-comments.js";

const WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?:[a-z]:[\\/]|\\\\)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?![a-z][a-z0-9+.-]*:|\/|#)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()\/(?!\/)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const WHITESPACE_OR_TEXT_PATTERN = /\s+|\S+/gu;
const WHITESPACE_PATTERN = /^\s+$/u;
const EXCESSIVE_NEWLINES_PATTERN = /\n{3,}/g;
const FOOTNOTE_REFERENCE_PATTERN = /\[\^[\w-]{1,200}\](?!:)/;
const FOOTNOTE_DEFINITION_PATTERN = /\[\^[\w-]{1,200}\]:/;
const FENCE_PATTERN = /^(?: {0,3})(`{3,}|~{3,})/u;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/u;
const INLINE_CODE_PATTERN = /(`+)[\s\S]*?\1/gu;
const PUNCTUATION_BOUNDARY_STRONG_PATTERN =
  /(?<![\p{L}\p{N}\\])(\*\*|__)(\S(?:(?!\1).)*?)(\p{P})\1(?=[\p{L}\p{N}])/gu;

export const UNC_FILE_REFERENCE_PREFIX = "/__codexly_unc__/";
export const RELATIVE_FILE_REFERENCE_PREFIX = "/__codexly_relative__/";

type MarkdownFence = Readonly<{
  character: "`" | "~";
  length: number;
}>;

function normalizePlainTextEmphasisBoundaries(source: string): string {
  return source.replace(
    PUNCTUATION_BOUNDARY_STRONG_PATTERN,
    (_match, marker: string, content: string, punctuation: string) =>
      `${marker}${content}${marker}${punctuation}`,
  );
}

class MarkdownEmphasisBoundaryNormalizer {
  private fence: MarkdownFence | null;

  constructor(fence: MarkdownFence | null = null) {
    this.fence = fence;
  }

  normalizeLine(source: string): string {
    const fenceMatch = FENCE_PATTERN.exec(source);
    if (this.fence !== null) {
      if (
        fenceMatch?.[1]?.startsWith(this.fence.character) === true &&
        fenceMatch[1].length >= this.fence.length
      ) {
        this.fence = null;
      }
      return source;
    }

    if (fenceMatch?.[1] !== undefined) {
      this.fence = {
        character: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      return source;
    }
    if (INDENTED_CODE_PATTERN.test(source)) {
      return source;
    }

    // 仅规范化普通文本片段，确保代码中的 Markdown 示例保持原样。
    let cursor = 0;
    let normalized = "";
    for (const match of source.matchAll(INLINE_CODE_PATTERN)) {
      normalized += normalizePlainTextEmphasisBoundaries(source.slice(cursor, match.index));
      normalized += match[0];
      cursor = match.index + match[0].length;
    }
    return normalized + normalizePlainTextEmphasisBoundaries(source.slice(cursor));
  }

  clone(): MarkdownEmphasisBoundaryNormalizer {
    return new MarkdownEmphasisBoundaryNormalizer(this.fence);
  }
}

export function normalizeMarkdownEmphasisBoundaries(markdown: string): string {
  const normalizer = new MarkdownEmphasisBoundaryNormalizer();
  return markdown
    .split("\n")
    .map((line) => normalizer.normalizeLine(line))
    .join("\n");
}

export function normalizeMarkdownFileReferences(markdown: string): string {
  // 路径目标不会跨行；该约束允许流式处理只保留尚未结束的当前行。
  return markdown
    .replace(WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) => {
      const normalizedReference = reference.replaceAll("\\", "/");
      if (/^[a-z]:/i.test(normalizedReference)) {
        return `/${normalizedReference}`;
      }
      return `${UNC_FILE_REFERENCE_PREFIX}${normalizedReference.slice(2)}`;
    })
    .replace(
      RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN,
      (reference) => `${RELATIVE_FILE_REFERENCE_PREFIX}${reference}`,
    )
    .replace(LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) =>
      reference.replaceAll(" ", "%20").replaceAll("\t", "%09"),
    );
}

export function preprocessMessageResponse(markdown: string): ParsedCodeComments {
  const parsedResponse = parseCodeComments(markdown);
  return {
    comments: parsedResponse.comments,
    markdown: normalizeMarkdownEmphasisBoundaries(
      normalizeMarkdownFileReferences(parsedResponse.markdown),
    ),
  };
}

class IncrementalWhitespaceBuffer {
  private output: string;
  private trailingWhitespace: string;

  constructor(output = "", trailingWhitespace = "") {
    this.output = output;
    this.trailingWhitespace = trailingWhitespace;
  }

  append(value: string): void {
    const additions: string[] = [];
    let hasContent = this.output.length > 0;
    for (const match of value.matchAll(WHITESPACE_OR_TEXT_PATTERN)) {
      const token = match[0];
      if (WHITESPACE_PATTERN.test(token)) {
        this.trailingWhitespace += token;
        continue;
      }
      if (hasContent && this.trailingWhitespace.length > 0) {
        additions.push(this.trailingWhitespace.replace(EXCESSIVE_NEWLINES_PATTERN, "\n\n"));
      }
      this.trailingWhitespace = "";
      additions.push(token);
      hasContent = true;
    }
    if (additions.length > 0) {
      this.output += additions.join("");
    }
  }

  clone(): IncrementalWhitespaceBuffer {
    return new IncrementalWhitespaceBuffer(this.output, this.trailingWhitespace);
  }

  materialize(): string {
    // 尾部空白由 trim() 语义丢弃，仅返回已经由后续正文确认的内容。
    return this.output;
  }
}

type ProcessingState = Readonly<{
  comments: CodeComment[];
  discardBlankLines: boolean;
  emphasisNormalizer: MarkdownEmphasisBoundaryNormalizer;
  whitespace: IncrementalWhitespaceBuffer;
}>;

function processLine(source: string, hasLineFeed: boolean, state: ProcessingState): boolean {
  const comment = parseCodeCommentDirective(source);
  if (comment !== null) {
    state.comments.push(comment);
    if (hasLineFeed) {
      state.whitespace.append("\n");
    }
    return true;
  }

  if (state.discardBlankLines && source.trim().length === 0) {
    return true;
  }

  const normalizedSource = state.emphasisNormalizer.normalizeLine(
    normalizeMarkdownFileReferences(source),
  );
  state.whitespace.append(`${normalizedSource}${hasLineFeed ? "\n" : ""}`);
  return false;
}

export class IncrementalMessageResponseProcessor {
  private cachedResult: ParsedCodeComments = { comments: [], markdown: "" };
  private committedComments: CodeComment[] = [];
  private discardBlankLines = false;
  private emphasisNormalizer = new MarkdownEmphasisBoundaryNormalizer();
  private pendingLine = "";
  private previousSource = "";
  private whitespace = new IncrementalWhitespaceBuffer();

  process(source: string): ParsedCodeComments {
    if (source === this.previousSource) {
      return this.cachedResult;
    }
    if (!source.startsWith(this.previousSource)) {
      this.reset();
    }

    this.pendingLine += source.slice(this.previousSource.length);
    this.previousSource = source;
    let lineFeedIndex = this.pendingLine.indexOf("\n");
    while (lineFeedIndex >= 0) {
      const line = this.pendingLine.slice(0, lineFeedIndex);
      this.pendingLine = this.pendingLine.slice(lineFeedIndex + 1);
      this.discardBlankLines = processLine(line, true, {
        comments: this.committedComments,
        discardBlankLines: this.discardBlankLines,
        emphasisNormalizer: this.emphasisNormalizer,
        whitespace: this.whitespace,
      });
      lineFeedIndex = this.pendingLine.indexOf("\n");
    }

    // 当前行仍可能继续增长，基于已提交状态制作轻量预览，不能污染后续 Chunk。
    const previewComments = [...this.committedComments];
    const previewEmphasisNormalizer = this.emphasisNormalizer.clone();
    const previewWhitespace = this.whitespace.clone();
    if (this.pendingLine.length > 0) {
      processLine(this.pendingLine, false, {
        comments: previewComments,
        discardBlankLines: this.discardBlankLines,
        emphasisNormalizer: previewEmphasisNormalizer,
        whitespace: previewWhitespace,
      });
    }
    this.cachedResult = {
      comments: previewComments,
      markdown: previewWhitespace.materialize(),
    };
    return this.cachedResult;
  }

  private reset(): void {
    this.cachedResult = { comments: [], markdown: "" };
    this.committedComments = [];
    this.discardBlankLines = false;
    this.emphasisNormalizer = new MarkdownEmphasisBoundaryNormalizer();
    this.pendingLine = "";
    this.previousSource = "";
    this.whitespace = new IncrementalWhitespaceBuffer();
  }
}

type MarkdownBlockParser = (markdown: string) => string[];

export function createIncrementalMarkdownBlockParser(
  parseBlocks: MarkdownBlockParser = parseMarkdownIntoBlocks,
): MarkdownBlockParser {
  let previousBlocks: string[] = [];
  let previousMarkdown = "";

  return (markdown) => {
    if (markdown === previousMarkdown) {
      return previousBlocks;
    }

    let sharedPrefixLength = 0;
    const maximumSharedLength = Math.min(previousMarkdown.length, markdown.length);
    while (
      sharedPrefixLength < maximumSharedLength &&
      previousMarkdown.charCodeAt(sharedPrefixLength) === markdown.charCodeAt(sharedPrefixLength)
    ) {
      sharedPrefixLength += 1;
    }

    let stableBlockCount = 0;
    let stableLength = 0;
    while (
      stableBlockCount < previousBlocks.length &&
      stableLength + (previousBlocks[stableBlockCount]?.length ?? 0) <= sharedPrefixLength
    ) {
      stableLength += previousBlocks[stableBlockCount]?.length ?? 0;
      stableBlockCount += 1;
    }
    // Markdown 的新后缀可能改变紧邻 Block（如 Setext 标题或列表），始终回退一块重解析。
    if (stableBlockCount > 0) {
      stableBlockCount -= 1;
      stableLength -= previousBlocks[stableBlockCount]?.length ?? 0;
    }

    const tail = markdown.slice(stableLength);
    previousBlocks =
      FOOTNOTE_REFERENCE_PATTERN.test(tail) || FOOTNOTE_DEFINITION_PATTERN.test(tail)
        ? [markdown]
        : [...previousBlocks.slice(0, stableBlockCount), ...parseBlocks(tail)];
    previousMarkdown = markdown;
    return previousBlocks;
  };
}
