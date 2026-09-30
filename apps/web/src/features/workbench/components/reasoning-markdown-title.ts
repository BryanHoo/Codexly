import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

export function getReasoningTitle(markdown: string): string {
  // 标题只提取 Markdown 文本；链接地址和格式标记保留在展开后的详情中。
  return fromMarkdown(markdown)
    .children.map((block) => toString(block, { includeHtml: false }))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}
