import { parseMarkdownIntoBlocks } from "streamdown";
import { describe, expect, it, vi } from "vitest";

import {
  createIncrementalMarkdownBlockParser,
  IncrementalMessageResponseProcessor,
  normalizeMarkdownEmphasisBoundaries,
  preprocessMessageResponse,
} from "./message-response-processing.js";

describe("streaming message response processing", () => {
  it("matches full preprocessing while directives and paths cross chunk boundaries", () => {
    const source = `  检查结果：

[server.ts](C:\\workspace\\Codexly\\server.ts:24)

::code-comment{title="[P1] 修复竞态" body="更新状态。" file="/workspace/server.ts" start=24 end=25 priority=1}

[guide.md](docs/guide.md:8)  `;
    const processor = new IncrementalMessageResponseProcessor();
    let streamedSource = "";

    for (const chunk of source.match(/.{1,7}/gs) ?? []) {
      streamedSource += chunk;
      expect(processor.process(streamedSource)).toEqual(preprocessMessageResponse(streamedSource));
    }

    const result = processor.process(source);
    expect(result.comments).toHaveLength(1);
    expect(result.markdown).toContain("/__codexly_relative__/docs/guide.md:8");
    expect(result.markdown).toContain("/C:/workspace/Codexly/server.ts:24");
  });

  it("reprocesses only the affected Markdown tail block", () => {
    const parseBlocks = vi.fn(parseMarkdownIntoBlocks);
    const incrementalParser = createIncrementalMarkdownBlockParser(parseBlocks);
    const initialMarkdown = "# 结果\n\n第一段。\n\n正在增长";
    const nextMarkdown = `${initialMarkdown}的末尾。`;

    incrementalParser(initialMarkdown);
    const nextBlocks = incrementalParser(nextMarkdown);

    expect(nextBlocks).toEqual(parseMarkdownIntoBlocks(nextMarkdown));
    expect(parseBlocks).toHaveBeenCalledTimes(2);
    expect(parseBlocks.mock.calls[1]?.[0].length).toBeLessThan(nextMarkdown.length);
  });

  it("repairs strong emphasis followed immediately by Chinese text", () => {
    const source = "结论： **在该源码版本中，目标模式由本地 Codex 实现。**准确说是本地编排。";

    expect(normalizeMarkdownEmphasisBoundaries(source)).toBe(
      "结论： **在该源码版本中，目标模式由本地 Codex 实现**。准确说是本地编排。",
    );
  });

  it("keeps emphasis-like content unchanged inside code", () => {
    const source = [
      "`**行内示例。**继续`",
      "",
      "```md",
      "**围栏示例。**继续",
      "```",
      "",
      "    **缩进示例。**继续",
    ].join("\n");

    expect(normalizeMarkdownEmphasisBoundaries(source)).toBe(source);
  });

  it("keeps repaired emphasis stable across character-by-character streaming", () => {
    const source = "结论： **本地 Codex 实现。**准确说是本地编排。";
    const processor = new IncrementalMessageResponseProcessor();
    let streamedSource = "";

    for (const character of source) {
      streamedSource += character;
      expect(processor.process(streamedSource)).toEqual(preprocessMessageResponse(streamedSource));
    }
  });

  it.each([
    ["list and fence", "# 标题\n\n- 第一项\n- 第二项\n\n```ts\nconst ready = true;\n```"],
    ["Setext heading", "普通段落\n\n逐步形成标题\n---\n\n结尾"],
    ["HTML block", "开头\n\n<section>\n  <strong>内容</strong>\n</section>\n\n结尾"],
    ["footnote", "正文[^note]\n\n[^note]: 说明"],
  ])("keeps incremental blocks equivalent for %s", (_name, source) => {
    const incrementalParser = createIncrementalMarkdownBlockParser();
    let streamedMarkdown = "";

    for (const character of source) {
      streamedMarkdown += character;
      expect(incrementalParser(streamedMarkdown)).toEqual(
        parseMarkdownIntoBlocks(streamedMarkdown),
      );
    }
  });

  it("resets incremental state when content is replaced", () => {
    const processor = new IncrementalMessageResponseProcessor();
    processor.process("旧内容\n\n[old.md](old.md:1)");

    expect(processor.process("新内容")).toEqual(preprocessMessageResponse("新内容"));
  });
});
