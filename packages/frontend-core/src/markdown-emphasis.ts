import { assistantDirectiveSpans } from "./assistant-directive-spans.js";

const FENCE_PATTERN = /^(?: {0,3})(`{3,}|~{3,})/u;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/u;
const INLINE_CODE_PATTERN = /(`+)[\s\S]*?\1/gu;
const PUNCTUATION_BOUNDARY_STRONG_PATTERN = /(\*\*|__)(\S(?:(?!\1).)*?)(\p{P})\1(?=[\p{L}\p{N}])/gu;
const WORD_OR_ESCAPE_PATTERN = /[\p{L}\p{N}\\]$/u;

type MarkdownFence = Readonly<{
  character: "`" | "~";
  length: number;
}>;

function normalizePlainTextEmphasisBoundaries(source: string): string {
  let cursor = 0;
  const parts: string[] = [];
  PUNCTUATION_BOUNDARY_STRONG_PATTERN.lastIndex = 0;
  let match = PUNCTUATION_BOUNDARY_STRONG_PATTERN.exec(source);
  while (match !== null) {
    // 显式检查左边界，避免共享模块在旧 WebKit 加载时依赖后行断言。
    if (WORD_OR_ESCAPE_PATTERN.test(source.slice(Math.max(0, match.index - 2), match.index))) {
      PUNCTUATION_BOUNDARY_STRONG_PATTERN.lastIndex = match.index + 1;
    } else {
      const [, marker = "", content = "", punctuation = ""] = match;
      parts.push(source.slice(cursor, match.index), `${marker}${content}${marker}${punctuation}`);
      cursor = match.index + match[0].length;
    }
    match = PUNCTUATION_BOUNDARY_STRONG_PATTERN.exec(source);
  }
  return parts.length === 0 ? source : parts.join("") + source.slice(cursor);
}

export class MarkdownEmphasisBoundaryNormalizer {
  private fence: MarkdownFence | null;

  constructor(fence: MarkdownFence | null = null) {
    this.fence = fence;
  }

  normalizeLine(source: string, lineStart = true): string {
    const fenceMatch = lineStart ? FENCE_PATTERN.exec(source) : null;
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
    if (lineStart && INDENTED_CODE_PATTERN.test(source)) {
      return source;
    }

    // 代码和特殊标记属性均为字面内容，不能通过排版修复改变文件路径或待发送 prompt。
    let cursor = 0;
    let normalized = "";
    const spans = [
      ...assistantDirectiveSpans(source),
      ...Array.from(source.matchAll(INLINE_CODE_PATTERN), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
      })),
    ].sort((left, right) => left.start - right.start);
    for (const span of spans) {
      if (span.end <= cursor) continue;
      if (span.start >= cursor)
        normalized += normalizePlainTextEmphasisBoundaries(source.slice(cursor, span.start));
      normalized += source.slice(Math.max(cursor, span.start), span.end);
      cursor = span.end;
    }
    return normalized + normalizePlainTextEmphasisBoundaries(source.slice(cursor));
  }

  clone(): MarkdownEmphasisBoundaryNormalizer {
    return new MarkdownEmphasisBoundaryNormalizer(this.fence);
  }

  isInsideFence(): boolean {
    return this.fence !== null;
  }
}

export function normalizeMarkdownEmphasisBoundaries(markdown: string): string {
  const normalizer = new MarkdownEmphasisBoundaryNormalizer();
  return markdown
    .split("\n")
    .map((line) => normalizer.normalizeLine(line))
    .join("\n");
}
