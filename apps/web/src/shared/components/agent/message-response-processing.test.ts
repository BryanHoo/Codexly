import { parseMarkdownIntoBlocks } from "streamdown";
import { describe, expect, it, vi } from "vitest";

import {
  createIncrementalMarkdownBlockParser,
  IncrementalMessageResponseProcessor,
  preprocessMessageResponse,
} from "./message-response-processing.js";

describe("streaming message response processing", () => {
  it("matches full preprocessing while directives and paths cross chunk boundaries", () => {
    const source = `  检查结果：

[server.ts](C:\\workspace\\Code Agent\\server.ts:24)

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
    expect(result.markdown).toContain("/__code_agent_relative__/docs/guide.md:8");
    expect(result.markdown).toContain("/C:/workspace/Code%20Agent/server.ts:24");
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
