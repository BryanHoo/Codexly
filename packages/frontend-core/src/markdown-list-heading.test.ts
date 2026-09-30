import { describe, expect, it } from "vitest";
import { separateBoldTitleFromNumberedList } from "./markdown-list-heading.js";

describe("separateBoldTitleFromNumberedList", () => {
  it("separates a standalone title from a continuing numbered list", () => {
    const source = "**功能与性能问题**\n4. 第四项";
    const expected = "**功能与性能问题**\n\n4. 第四项";
    expect(separateBoldTitleFromNumberedList(source)).toBe(expected);
    expect(separateBoldTitleFromNumberedList(expected)).toBe(expected);
  });

  it("preserves code fences and inline prose", () => {
    const source = [
      "```md",
      "**示例标题**",
      "4. 示例项",
      "```",
      "",
      "句中 **加粗文本**",
      "4. 保持原样",
    ].join("\n");
    expect(separateBoldTitleFromNumberedList(source)).toBe(source);
  });
});
