import { describe, expect, it } from "vitest";

import { AppendOnlyTextBuffer } from "./append-only-text.js";
import { getReasoningBody, getReasoningBodySource } from "./reasoning-summary.js";

describe("reasoning summary body", () => {
  it.each([
    "**Evaluating API support**\n\n正文\n\n## 后续标题\n\n保留内容",
    "## **Evaluating API support**\n\n正文\n\n## 后续标题\n\n保留内容",
    "\r\n__Evaluating API support__\r\n\r\n正文\n\n## 后续标题\n\n保留内容",
  ])("omits only the opening title: %j", (summary) => {
    expect(getReasoningBody(summary)).toBe("正文\n\n## 后续标题\n\n保留内容");
  });

  it.each([
    "普通正文\n\n第二段",
    "**重点** 后面仍是正文\n\n第二段",
    "```markdown\n## 代码中的标题\n```",
    "    ## 缩进代码",
    "**尚未完成的标题",
  ])("preserves content without a standalone title: %j", (summary) => {
    expect(getReasoningBody(summary)).toBe(summary);
  });

  it("handles a title before body text arrives", () => {
    expect(getReasoningBody("**Evaluating API support**")).toBe("");
    expect(getReasoningBody("## Evaluating API support\n")).toBe("");
  });

  it("omits the title from incremental snapshots and retains old snapshot boundaries", () => {
    const buffer = new AppendOnlyTextBuffer("**Evaluating");
    buffer.append(" API support**\n\n正文");
    const source = buffer.getSnapshot();
    const offset = buffer.materialize().length - getReasoningBody(buffer.materialize()).length;
    const body = getReasoningBodySource(source, offset);
    expect(body.chunks.slice(0, body.chunkCount).join("")).toBe("正文");
    expect(getReasoningBodySource(source, offset)).toBe(body);
    buffer.append("后续内容");
    const next = getReasoningBodySource(buffer.getSnapshot(), offset);
    expect(next.chunks.slice(0, next.chunkCount).join("")).toBe("正文后续内容");
    expect(body.chunks.slice(0, body.chunkCount).join("")).toBe("正文");
    expect(source.chunks.slice(0, source.chunkCount).join("")).toBe(
      "**Evaluating API support**\n\n正文",
    );
    expect(getReasoningBodySource(source, 0)).toBe(source);
  });
});
