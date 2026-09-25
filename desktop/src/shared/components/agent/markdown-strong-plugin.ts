import { splitUnparsedStrong } from "../../lib/markdown-strong.js";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

export function unparsedStrongRemarkPlugin() {
  return (tree: MarkdownNode, file: { value?: unknown }): void => {
    const source = typeof file.value === "string" ? file.value : "";
    function visit(node: MarkdownNode): void {
      if (!node.children) return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== "text" || !child.value?.includes("**")) {
          visit(child);
          return [child];
        }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        // 转义和实体解码后的文本不能当作 Markdown 再解析，避免字面量意外变成样式。
        if (start === undefined || end === undefined || source.slice(start, end) !== child.value) return [child];
        const parts = splitUnparsedStrong(child.value);
        return parts?.map((part) => part.strong
          ? { type: "strong", children: [{ type: "text", value: part.text }] }
          : { type: "text", value: part.text }) ?? [child];
      });
    }
    visit(tree);
  };
}
