import {
  appendTextSequence, replaceSequenceTail, sequenceItem, type SequenceNode,
} from "../../lib/persistent-sequence.js";

type BlockSource = Readonly<{ content: string; source: string }>;
type CodeLine = string | SequenceNode<string>;
export type CodeLineTree = SequenceNode<CodeLine> | null;
export type MarkdownBlock = BlockSource & (
  Readonly<{ kind: "markdown" }> |
  Readonly<{ kind: "deferred"; text: SequenceNode<string> | null }> |
  Readonly<{ kind: "text"; text: SequenceNode<string> | null; suffix: string }> |
  Readonly<{ kind: "code"; lines: CodeLineTree; code: string; fence: string; language: string; fenceState: FenceState }>
);

// 已解析前缀保持不变；超预算的新增内容仅更新文本尾页，不再送入 Markdown 引擎。
export function deferMarkdownBlock(
  previous: MarkdownBlock | undefined, source: string, replaceFrom: number, replacement: string,
): MarkdownBlock {
  if (previous?.kind === "deferred" && replaceFrom === previous.source.length) {
    return { ...previous, source, text: appendTextSequence(previous.text, replacement) };
  }
  const prefix = previous !== undefined && previous.kind !== "deferred" &&
    previous.content.length <= 8_192 && replaceFrom >= previous.source.length ? previous : undefined;
  const previewFrom = prefix?.source.length ?? 0;
  return {
    kind: "deferred", source, content: prefix?.content ?? "",
    text: appendTextSequence(null, source.slice(previewFrom)),
  };
}

const PLAIN_TEXT = /^[\p{L}\p{N} ,.!?，。！？、;；]+$/u;
const FENCE_START = /^(`{3,}|~{3,})([^\n]*)\n/;

function appendCodeLine(line: CodeLine, addition: string): CodeLine {
  // 常规短行直接存字符串；只有长行需要分页树，避免给每行分配深层索引。
  if (typeof line === "string") {
    const text = line + addition;
    return text.length <= 1_024 ? text : appendTextSequence(null, text)!;
  }
  return appendTextSequence(line, addition)!;
}

type FenceState = Readonly<{ spaces: number; markers: number; phase: "indent" | "marker" | "space" | "other" }>;
const EMPTY_FENCE_STATE: FenceState = { spaces: 0, markers: 0, phase: "indent" };

function advanceFence(state: FenceState, text: string, fence: string): FenceState | null {
  let { spaces, markers, phase } = state;
  for (const character of text) {
    if (character === "\n") {
      if (markers >= fence.length && (phase === "marker" || phase === "space")) return null;
      spaces = 0; markers = 0; phase = "indent";
    } else if (phase === "indent" && character === " " && spaces < 3) {
      spaces += 1;
    } else if ((phase === "indent" || phase === "marker") && character === fence[0]) {
      phase = "marker";
      markers += 1;
    } else if ((phase === "marker" || phase === "space") && (character === " " || character === "\t")) {
      phase = "space";
    } else {
      phase = "other";
    }
  }
  return markers >= fence.length && (phase === "marker" || phase === "space")
    ? null : { spaces, markers, phase };
}

export function createMarkdownBlock(content: string, source: string): MarkdownBlock {
  if (/^\p{L}/u.test(content) && PLAIN_TEXT.test(content) && !/www\./i.test(content)) {
    return { kind: "text", content, source, text: appendTextSequence(null, content), suffix: content.slice(-4) };
  }
  const fence = FENCE_START.exec(content);
  if (fence !== null && !source.includes("\r")) {
    const marker = fence[1]!;
    const code = content.slice(fence[0].length);
    const fenceState = advanceFence(EMPTY_FENCE_STATE, code, marker);
    if (fenceState !== null && !(marker[0] === "`" && fence[2]!.includes("`"))) {
      return {
        kind: "code", content, source, code, fence: marker, fenceState,
        language: fence[2]!.trim().split(/\s/)[0] ?? "",
        lines: replaceSequenceTail(null, 0, code.split("\n").map((line) => appendCodeLine("", line))),
      };
    }
  }
  return { kind: "markdown", content, source };
}

export function appendMarkdownBlock(block: MarkdownBlock, addition: string): MarkdownBlock | null {
  if (addition === "") return block;
  if (block.kind === "text" && PLAIN_TEXT.test(addition) && !/www\./i.test(block.suffix + addition)) {
    return {
      ...block, content: block.content + addition, source: block.source + addition,
      text: appendTextSequence(block.text, addition), suffix: (block.suffix + addition).slice(-4),
    };
  }
  // 关闭围栏、CRLF 或复杂边界出现时回交 Streamdown；普通代码内容只追加末行。
  if (block.kind === "code" && !addition.includes("\r")) {
    const fenceState = advanceFence(block.fenceState, addition, block.fence);
    if (fenceState === null) return null;
    const lastIndex = Math.max(0, (block.lines?.size ?? 0) - 1);
    const lastLine = sequenceItem(block.lines, lastIndex) ?? "";
    const parts = addition.split("\n");
    const lines = [appendCodeLine(lastLine, parts[0]!), ...parts.slice(1).map((line) => appendCodeLine("", line))];
    return {
      ...block, content: block.content + addition, source: block.source + addition, code: block.code + addition, fenceState,
      lines: replaceSequenceTail(block.lines, lastIndex, lines),
    };
  }
  return null;
}
