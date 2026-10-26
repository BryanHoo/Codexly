import { describe, expect, it } from "vitest";
import { normalizeMarkdownEmphasisBoundaries } from "./markdown-emphasis.js";

describe("含行内代码的中文粗体边界", () => {
  it.each([
    ["**0.164.0 支持 `feedback/save`。**之前", "**0.164.0 支持 `feedback/save`**。之前"],
    ["__支持 `feedback/save`。__之前", "__支持 `feedback/save`__。之前"],
    ["**包含 `**代码。**继续` 的正文。**继续", "**包含 `**代码。**继续` 的正文**。继续"],
    ["**包含 ``带 ` 的代码`` 的正文。**继续", "**包含 ``带 ` 的代码`` 的正文**。继续"],
  ])("保留代码原文并修复完整粗体：%s", (source, expected) => {
    expect(normalizeMarkdownEmphasisBoundaries(source)).toBe(expected);
  });

  it.each([
    "`**代码。**继续`",
    "``**代码。**继续``",
    "```md\n**代码 `feedback/save`。**继续\n```",
    "    **代码 `feedback/save`。**继续",
    "\\**正文 `feedback/save`。**继续",
    '::codex-followup{prompt="**调用 `feedback/save`。**继续"}',
  ])("保留代码、转义和指令中的字面量：%s", (source) => {
    expect(normalizeMarkdownEmphasisBoundaries(source)).toBe(source);
  });
});
