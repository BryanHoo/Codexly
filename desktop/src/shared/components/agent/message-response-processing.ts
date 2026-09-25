import type { TextSnapshot } from "../../lib/append-only-text.js";

import {
  parseCodeCommentDirective,
  parseCodeComments,
  type CodeComment,
  type ParsedCodeComments,
} from "./code-comments.js";

const WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN =
  /\]\(((?:[a-z]:[\\/]|\\\\)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?)(?=\))/gi;
const RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN =
  /\]\(((?![a-z][a-z0-9+.-]*:|\/|#)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?)(?=\))/gi;
const LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN =
  /\]\((\/(?!\/)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?)(?=\))/gi;
const WHITESPACE_OR_TEXT_PATTERN = /\s+|\S+/gu;
const WHITESPACE_PATTERN = /^\s+$/u;
const EXCESSIVE_NEWLINES_PATTERN = /\n{3,}/g;

export const UNC_FILE_REFERENCE_PREFIX = "/__codeagent_unc__/";
export const RELATIVE_FILE_REFERENCE_PREFIX = "/__codeagent_relative__/";

export function normalizeMarkdownFileReferences(markdown: string): string {
  // 路径目标不会跨行；该约束允许流式处理只保留尚未结束的当前行。
  // 消费并还原链接前缀，避免旧 WebKit 在加载模块时因后行断言直接报错。
  return markdown
    .replace(WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN, (_match, reference: string) => {
      const normalizedReference = reference.replaceAll("\\", "/");
      if (/^[a-z]:/i.test(normalizedReference)) {
        return `](/${normalizedReference}`;
      }
      return `](${UNC_FILE_REFERENCE_PREFIX}${normalizedReference.slice(2)}`;
    })
    .replace(
      RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN,
      (_match, reference: string) => `](${RELATIVE_FILE_REFERENCE_PREFIX}${reference}`,
    )
    .replace(LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN, (_match, reference: string) =>
      `](${reference.replaceAll(" ", "%20").replaceAll("\t", "%09")}`,
    );
}

export function preprocessMessageResponse(markdown: string): ParsedCodeComments {
  const parsedResponse = parseCodeComments(markdown);
  return {
    comments: parsedResponse.comments,
    markdown: normalizeMarkdownFileReferences(parsedResponse.markdown),
  };
}

class IncrementalWhitespaceBuffer {
  private delta = "";
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
      const addition = additions.join("");
      this.output += addition;
      this.delta += addition;
    }
  }

  clone(): IncrementalWhitespaceBuffer {
    return new IncrementalWhitespaceBuffer(this.output, this.trailingWhitespace);
  }

  materialize(): string {
    // 尾部空白由 trim() 语义丢弃，仅返回已经由后续正文确认的内容。
    return this.output;
  }

  takeDelta(): string {
    const delta = this.delta;
    this.delta = "";
    return delta;
  }
}

type ProcessingState = Readonly<{
  comments: CodeComment[];
  discardBlankLines: boolean;
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

  state.whitespace.append(`${normalizeMarkdownFileReferences(source)}${hasLineFeed ? "\n" : ""}`);
  return false;
}

export type ProcessedMessageResponse = ParsedCodeComments & Readonly<{
  replaceFrom: number;
  replacement: string;
}>;

function pendingFileReferenceStart(line: string, previousLength: number): number {
  let start = previousLength > 1 || (previousLength === 1 && line.startsWith("(")) ? 0 : -1;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === ")" || character === "\r") {
      start = -1;
    } else if (start < 0 && character === "]" && line[index + 1] === "(") {
      start = previousLength + index;
    }
  }
  // 仅未闭合的 ](target 和 Chunk 末尾的 ] 需要等待；普通方括号和完整链接立即提交。
  const length = previousLength + line.length;
  return start >= 0 ? start : line.endsWith("]") ? length - 1 : length;
}

export class IncrementalMessageResponseProcessor {
  private cachedResult: ProcessedMessageResponse = { comments: [], markdown: "", replaceFrom: 0, replacement: "" };
  private committedComments: CodeComment[] = [];
  private discardBlankLines = false;
  private pendingLine = "";
  private pendingReferenceLength = 0;
  private pendingReferencePreview: IncrementalWhitespaceBuffer | undefined;
  private lineStarted = false;
  private previousSource: string | TextSnapshot = "";
  private whitespace = new IncrementalWhitespaceBuffer();

  process(source: string | TextSnapshot): ProcessedMessageResponse {
    const previous = this.previousSource;
    if (source === previous || (typeof source !== "string" && typeof previous !== "string" &&
      source.chunks === previous.chunks && source.chunkCount === previous.chunkCount)) {
      return this.cachedResult;
    }
    let addition: string;
    if (typeof source === "string") {
      // 普通字符串没有追加契约；替换时完整重置，流式输入统一使用 Chunk 快照。
      this.reset();
      addition = source;
    } else {
      const continuing = typeof previous !== "string" && previous.chunks === source.chunks &&
        previous.chunkCount <= source.chunkCount;
      if (!continuing) this.reset();
      const start = continuing ? previous.chunkCount : 0;
      addition = source.chunks.slice(start, source.chunkCount).join("");
    }
    this.previousSource = source;
    if (addition.length === 0) return this.cachedResult;

    let replaceFrom = this.whitespace.materialize().length;
    let previousReferenceLength = this.pendingReferenceLength;
    const previousPendingLength = this.pendingLine.length;
    this.pendingLine += addition;
    const addedLineFeedIndex = addition.indexOf("\n");
    let lineFeedIndex = addedLineFeedIndex < 0 ? -1 : previousPendingLength + addedLineFeedIndex;
    while (lineFeedIndex >= 0) {
      const line = this.pendingLine.slice(0, lineFeedIndex);
      this.pendingLine = this.pendingLine.slice(lineFeedIndex + 1);
      this.commitLine(line, true);
      this.lineStarted = false;
      previousReferenceLength = 0;
      lineFeedIndex = this.pendingLine.indexOf("\n");
    }

    // 普通行无需等换行；只保留可能成为评论指令或文件链接目标的后缀。
    const directive = "::code-comment{";
    const mayBeDirective = previousReferenceLength === 0 && !this.lineStarted &&
      (directive.startsWith(this.pendingLine) || this.pendingLine.startsWith(directive));
    const mayBeDiscardedBlankLine = previousReferenceLength === 0 && this.discardBlankLines && !this.lineStarted && this.pendingLine.trim().length === 0;
    let reuseReferencePreview = false;
    this.pendingReferenceLength = 0;
    if (!mayBeDirective && !mayBeDiscardedBlankLine) {
      // 已等待的目标前缀不再读取；字符串索引也可能迫使 WebKit 展平整条增长中的 rope。
      const committedLength = pendingFileReferenceStart(previousReferenceLength > 0 ? addition : this.pendingLine, previousReferenceLength);
      if (committedLength > 0) {
        this.commitLine(this.pendingLine.slice(0, committedLength), false);
        this.pendingLine = this.pendingLine.slice(committedLength);
        this.lineStarted = true;
      } else {
        reuseReferencePreview = previousReferenceLength > 0;
      }
      this.pendingReferenceLength = this.pendingLine.length;
    }

    // 当前行仍可能继续增长，基于已提交状态制作轻量预览，不能污染后续 Chunk。
    const previewComments = [...this.committedComments];
    const previewWhitespace = reuseReferencePreview && this.pendingReferencePreview !== undefined
      ? this.pendingReferencePreview : this.whitespace.clone();
    if (reuseReferencePreview) replaceFrom = this.cachedResult.markdown.length;
    if (this.pendingLine.length > 0) {
      // 未闭合链接不可能被规范化；沿用预览状态，仅扫描新增字节，闭合后再一次性替换目标。
      if (this.pendingReferenceLength > 0) {
        previewWhitespace.append(reuseReferencePreview ? addition : this.pendingLine);
      } else if (this.lineStarted) previewWhitespace.append(normalizeMarkdownFileReferences(this.pendingLine));
      else processLine(this.pendingLine, false, {
        comments: previewComments,
        discardBlankLines: this.discardBlankLines,
        whitespace: previewWhitespace,
      });
    }
    this.pendingReferencePreview = this.pendingReferenceLength > 0 ? previewWhitespace : undefined;
    this.cachedResult = {
      comments: previewComments,
      markdown: previewWhitespace.materialize(),
      // 已提交正文不变，只替换上一次的未结束行；分块器直接使用边界，无需比较前缀。
      replaceFrom,
      replacement: this.whitespace.takeDelta() + previewWhitespace.takeDelta(),
    };
    return this.cachedResult;
  }

  private commitLine(line: string, hasLineFeed: boolean): void {
    if (this.lineStarted) {
      this.whitespace.append(`${normalizeMarkdownFileReferences(line)}${hasLineFeed ? "\n" : ""}`);
      return;
    }
    this.discardBlankLines = processLine(line, hasLineFeed, {
      comments: this.committedComments,
      discardBlankLines: this.discardBlankLines,
      whitespace: this.whitespace,
    });
  }

  private reset(): void {
    this.cachedResult = { comments: [], markdown: "", replaceFrom: 0, replacement: "" };
    this.committedComments = [];
    this.discardBlankLines = false;
    this.pendingLine = "";
    this.pendingReferenceLength = 0;
    this.pendingReferencePreview = undefined;
    this.lineStarted = false;
    this.previousSource = "";
    this.whitespace = new IncrementalWhitespaceBuffer();
  }
}
