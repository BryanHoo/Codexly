import { expect, it } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";
import { parseMarkdownBlocks } from "./markdown-block-lexer.js";

it.each([
  "",
  "普通正文\n\n尾段",
  "# 标题\n\n正文\n\n---\n",
  "标题\n====\n\n结尾",
  "- **项目**\n  - 嵌套\n\n- 下一项\n",
  "1. 第一项\n\n2. 第二项\n",
  "> 引用\n>\n> - 列表\n\n结尾",
  "| A | B |\n| - | - |\n| 值 | 内容 |\n\n结尾",
  "```ts\nconst value = 1;\n```\n\n结尾",
  "~~~~md\n未闭合围栏\n",
  "    缩进代码 $$\n\n普通正文\n\n尾段",
  "$$\n数学公式\n\n跨空行\n$$\n\n结尾",
  "正文[^note]\n\n[^note]: 说明\n\n第二段",
  "[^note]: 说明\n\n另一段",
  "[文件][id]\n\n[id]: /file.ts",
  "<div>\n\n正文\n\n<div>\n\n嵌套\n\n</div>\n\n</div>\n\n尾段",
  "<DIV>\n\n正文\n\n</div>\n\n尾段",
  "<div>\n\n<div/>\n\n</div>",
  "<br>\n\n正文\n\n尾段",
  "<!-- 注释\n\n多行\n-->\n\n尾段",
  "# 标题\r\n\r\n- 项目😀\r\n\r\n尾段",
])("共享 Worker 分块与 Streamdown 在每个增量边界保持一致：%s", (source) => {
  for (let end = 0; end <= source.length; end += 1) {
    const prefix = source.slice(0, end);
    expect(parseMarkdownBlocks(prefix)).toEqual(parseMarkdownIntoBlocks(prefix));
  }
});

it("混合语法的确定性回放与 Streamdown 分块一致", () => {
  const tokens = [
    "word ",
    "**",
    "\n",
    "\n\n",
    "$$",
    "```",
    "- item\n",
    "<div>\n",
    "</div>\n",
    "<br>\n",
    "[^note]",
    "中文😀",
    "\r\n",
  ];
  let seed = 17;
  for (let trial = 0; trial < 500; trial += 1) {
    let source = "";
    for (let index = 0; index < 20; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      source += tokens[seed % tokens.length] ?? "";
    }
    expect(parseMarkdownBlocks(source)).toEqual(parseMarkdownIntoBlocks(source));
  }
});
