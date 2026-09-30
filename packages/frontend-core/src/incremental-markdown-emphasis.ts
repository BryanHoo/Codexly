import type { ProcessedMessageResponse } from "./incremental-message-response.js";
import { MarkdownEmphasisBoundaryNormalizer } from "./markdown-emphasis.js";

const INLINE_CODE = /(`+)[\s\S]*?\1/gu;
const COMPLETE_EMPHASIS = /(\*\*|__)(\S(?:(?!\1).)*?)\1./gu;
const REPAIRED_EMPHASIS = /(\*\*|__)(\S(?:(?!\1).)*?)(\p{P})\1(?=[\p{L}\p{N}])/gu;
const MARKER = /`|\*\*|__|[*_]$/gu;
const WORD_OR_ESCAPE = /[\p{L}\p{N}\\]$/u;

function stableLength(source: string): number {
  let offset = 0;
  const spans: { start: number; end: number }[] = [];
  const boundary = (length: number) => {
    let result = Math.max(0, length);
    // 粗体修复会移动闭合标记内的标点；提交边界不能切开整个变换跨度。
    let previous;
    do {
      previous = result;
      for (let index = spans.length - 1; index >= 0; index -= 1) {
        const span = spans[index];
        if (span === undefined) continue;
        if (result > span.start && result <= span.end) result = Math.max(0, span.start - 2);
      }
      // 保留标记前的字符；否则被转义或紧邻字母的标记会在尾部误变成合法起点。
      if (result > 0 && /[*_`]/u.test(source[result] ?? "")) {
        while (result > 0 && /[*_`]/u.test(source[result] ?? "")) result -= 1;
        result = Math.max(0, result - 1);
      }
    } while (previous !== result);
    return result;
  };
  while (offset < source.length) {
    // 已闭合的代码和粗体不会受后续字符影响；保留一个字符作为正则左边界。
    INLINE_CODE.lastIndex = offset;
    COMPLETE_EMPHASIS.lastIndex = offset;
    REPAIRED_EMPHASIS.lastIndex = offset;
    MARKER.lastIndex = offset;
    const marker = MARKER.exec(source);
    if (marker === null) return boundary(source.length - 2);
    const code = INLINE_CODE.exec(source);
    if (code?.index === marker.index) {
      let openingLength = 0;
      while (source[marker.index + openingLength] === "`") openingLength += 1;
      // 正则可能暂时把多反引号拆成短匹配；后续同长度闭合符仍会改变整个代码跨度。
      if ((code[1]?.length ?? 0) < openingLength) return boundary(marker.index - 2);
      offset = code.index + code[0].length;
      spans.push({ start: code.index, end: offset });
      continue;
    }
    if (marker[0] !== "`" && marker[0].length === 2) {
      const next = source[marker.index + 2];
      if (
        WORD_OR_ESCAPE.test(source.slice(Math.max(0, marker.index - 2), marker.index)) ||
        (next !== undefined && /\s/u.test(next))
      ) {
        offset = marker.index + 1;
        continue;
      }
    }
    const emphasis = COMPLETE_EMPHASIS.exec(source);
    if (emphasis?.index === marker.index) {
      const emphasisEnd = emphasis.index + emphasis[0].length;
      if (code !== null && code.index > marker.index && code.index < emphasisEnd) {
        // 粗体规则只能作用于代码外的文本片段，不能跨越已闭合的行内代码。
        offset = marker.index + 1;
        continue;
      }
      const tick = source.indexOf("`", marker.index);
      if (tick >= 0 && tick < emphasisEnd) return boundary(marker.index - 2);
      const repaired = REPAIRED_EMPHASIS.exec(source);
      if (repaired?.index === marker.index) {
        offset = repaired.index + repaired[0].length;
        spans.push({ start: repaired.index, end: offset });
      } else {
        // 未触发修复的跨度内部仍可能含另一种标记，继续逐个检查，不能吞掉内部起点。
        offset = marker.index + 1;
      }
      continue;
    }
    return boundary(marker.index - 2);
  }
  return boundary(source.length - 2);
}

class EmphasisLine {
  private readonly normalizer: MarkdownEmphasisBoundaryNormalizer;
  private stableSource = "";
  private stableOutput = "";
  private pending = "";
  private preview = "";
  private prefix = "";
  private unchanged = false;
  private suffix = "";

  constructor(normalizer: MarkdownEmphasisBoundaryNormalizer) {
    this.normalizer = normalizer;
  }

  get source(): string {
    return this.stableSource + this.pending;
  }
  get markdown(): string {
    return this.stableOutput + this.preview;
  }

  update(replaceFrom: number, replacement: string): { replaceFrom: number; replacement: string } {
    let appendOnly = replaceFrom === this.stableSource.length + this.pending.length;
    const previousSuffix = this.suffix;
    if (replaceFrom < this.stableSource.length) {
      // 文件目标闭合或回放可能改写已提交片段，仅此时重建当前行。
      this.pending = this.source.slice(0, replaceFrom) + replacement;
      this.stableSource = "";
      this.stableOutput = "";
      this.preview = "";
      this.prefix = "";
      this.unchanged = false;
      appendOnly = false;
      replaceFrom = 0;
      replacement = this.pending;
    } else {
      this.pending =
        (appendOnly
          ? this.pending
          : this.pending.slice(0, replaceFrom - this.stableSource.length)) + replacement;
    }
    const from = this.stableSource.length;
    if (!appendOnly) this.prefix = this.source.slice(0, 6);
    else if (this.prefix.length < 6) this.prefix = (this.prefix + replacement).slice(0, 6);
    // 围栏、缩进代码以及现有围栏内的行不做粗体修复，无须读取增长中的正文。
    if (this.stableSource.length === 0) {
      this.unchanged =
        /^(?: {0,3})(`{3,}|~{3,})|^(?: {4}|\t)/u.test(this.prefix) ||
        this.normalizer.isInsideFence();
    }
    const needsScan =
      !appendOnly || /[*_`]/u.test(replacement) || /(?:\*\*|__|`)$/u.test(previousSuffix);
    const normalized = this.unchanged
      ? this.pending
      : needsScan
        ? this.normalizer.clone().normalizeLine(this.pending, this.stableSource.length === 0)
        : this.preview + replacement;
    const relativeFrom = replaceFrom - from;
    const unchangedPrefix =
      (appendOnly && !needsScan) ||
      normalized.slice(0, relativeFrom) === this.preview.slice(0, relativeFrom);
    const output = unchangedPrefix
      ? {
          replaceFrom,
          replacement: appendOnly && !needsScan ? replacement : normalized.slice(relativeFrom),
        }
      : { replaceFrom: from, replacement: normalized };
    // 未闭合的长跨度只追加预览，只有新标记出现才重新检查；普通尾部保持有界。
    const length = this.unchanged
      ? this.pending.length
      : !needsScan && this.pending.length > 8_192
        ? 0
        : this.prefix.length < 6
          ? 0
          : stableLength(this.pending);
    this.stableSource += this.pending.slice(0, length);
    this.stableOutput += normalized.slice(0, length);
    this.pending = this.pending.slice(length);
    this.preview = normalized.slice(length);
    this.suffix =
      replacement.length >= 2 ? replacement.slice(-2) : (previousSuffix + replacement).slice(-2);
    return output;
  }

  next(): EmphasisLine {
    this.normalizer.normalizeLine(this.source);
    return new EmphasisLine(this.normalizer);
  }
}

export class IncrementalEmphasisProcessor<Comment> {
  private committed = "";
  private line = new EmphasisLine(new MarkdownEmphasisBoundaryNormalizer());
  private previous: ProcessedMessageResponse<Comment> | undefined;
  private cached: ProcessedMessageResponse<Comment> = {
    markdown: "",
    comments: [],
    replaceFrom: 0,
    replacement: "",
  };

  process(response: ProcessedMessageResponse<Comment>): ProcessedMessageResponse<Comment> {
    if (response === this.previous) return this.cached;
    let { replaceFrom, replacement } = response;
    if (replaceFrom < this.committed.length) {
      this.committed = "";
      this.line = new EmphasisLine(new MarkdownEmphasisBoundaryNormalizer());
      replaceFrom = 0;
      replacement = response.markdown;
    }
    const parts = replacement.split("\n");
    const updates: string[] = [];
    let outputFrom = 0;
    for (let index = 0; index < parts.length; index += 1) {
      const update = this.line.update(
        index === 0 ? replaceFrom - this.committed.length : 0,
        parts[index] ?? "",
      );
      if (index === 0) outputFrom = this.committed.length + update.replaceFrom;
      updates.push(update.replacement);
      if (index < parts.length - 1) {
        updates.push("\n");
        this.committed += this.line.markdown + "\n";
        this.line = this.line.next();
      }
    }
    this.previous = response;
    this.cached = {
      comments: response.comments,
      markdown: this.committed + this.line.markdown,
      replaceFrom: outputFrom,
      replacement: updates.join(""),
    };
    return this.cached;
  }
}
