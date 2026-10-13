import {
  findAssistantDirectives,
  isLocalDirectivePath,
  type AssistantDirective,
} from "./assistant-directives.js";
import { FILE_CITATION_PREFIX } from "./codex-file-citation.js";
import { normalizeMarkdownEmphasisBoundaries } from "./markdown-emphasis.js";
import {
  FOLLOWUP_LINK_PREFIX,
  GIT_RECEIPT_LINK_PREFIX,
  getGitReceipt,
} from "./assistant-directive-links.js";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?:
    { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined;
}
interface MarkdownParser {
  parse: (source: string) => MarkdownNode;
}
const LITERAL_NODES = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "html",
  "definition",
]);
type Replacement = Readonly<{
  start: number;
  end: number;
  markdown: string;
  followup?: { href: string; label: string };
}>;

function fileLink(path: string): string {
  return `[file](${FILE_CITATION_PREFIX}${encodeURIComponent(path)})`;
}

function followupHref(directive: AssistantDirective): string {
  return `${FOLLOWUP_LINK_PREFIX}${encodeURIComponent(directive.attributes.get("prompt") ?? "")}#${String(directive.start)}`;
}

function replacementFor(directive: AssistantDirective): string | null {
  const { name, attributes, label } = directive;
  if (name === "codex-file-citation" || name === "codex-inline-vis") {
    const path = attributes.get(name === "codex-file-citation" ? "path" : "file");
    return isLocalDirectivePath(path) ? fileLink(path) : null;
  }
  if (name === "codex-followup" && label?.trim()) {
    const prompt = attributes.get("prompt");
    // TUI 仅显示标签；应用在具备当前任务输入权限时提供点选填入草稿的动作。
    return prompt?.trim() ? `[followup](${followupHref(directive)})` : label;
  }
  if (name === "codex-realtime-inline" && attributes.size === 0) return "";
  const receipt = getGitReceipt(directive);
  return receipt === null
    ? null
    : `[git](${GIT_RECEIPT_LINK_PREFIX}${encodeURIComponent(JSON.stringify(receipt))})`;
}

function visualizationReferences(source: string): Replacement[] {
  const result: Replacement[] = [];
  const prefix = "visualize";
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(prefix, cursor);
    if (start < 0) break;
    const end = source.indexOf("", start + prefix.length);
    if (end < 0) break;
    cursor = end + 1;
    try {
      const value: unknown = JSON.parse(source.slice(start + prefix.length, end));
      if (typeof value !== "object" || value === null || !("path" in value)) continue;
      if (typeof value.path !== "string" || !isLocalDirectivePath(value.path)) continue;
      result.push({ start, end: end + 1, markdown: fileLink(value.path) });
    } catch {
      /* 非完整 JSON 的流式标记保留原文，下一次块更新后再处理。 */
    }
  }
  return result;
}

export function assistantDirectiveRemarkPlugin(this: MarkdownParser) {
  return (tree: MarkdownNode, file: { value: unknown }): MarkdownNode | undefined => {
    const source = String(file.value);
    if (!source.includes(":") && !source.includes("visualize")) return;
    const directives = findAssistantDirectives(source);
    const replacements: Replacement[] = directives.flatMap((directive) => {
      const markdown = replacementFor(directive);
      if (markdown === null) return [];
      const followup =
        directive.name === "codex-followup" &&
        directive.label?.trim() &&
        directive.attributes.get("prompt")?.trim()
          ? { href: followupHref(directive), label: directive.label }
          : null;
      return [
        {
          start: directive.start,
          end: directive.end,
          markdown,
          ...(followup === null ? {} : { followup }),
        },
      ];
    });
    // JSON 可视化引用同样不能从其他指令的隐藏属性中“逃逸”。
    const visuals = visualizationReferences(source);
    let directiveIndex = 0;
    for (const visual of visuals) {
      while ((directives[directiveIndex]?.end ?? Infinity) <= visual.start) directiveIndex += 1;
      const containing = directives[directiveIndex];
      if (containing !== undefined && containing.start <= visual.start) continue;
      replacements.push(visual);
    }
    if (replacements.length === 0) return;
    replacements.sort((left, right) => left.start - right.start);
    const literals: { start: number; end: number }[] = [];
    const visit = (node: MarkdownNode) => {
      if (LITERAL_NODES.has(node.type)) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) literals.push({ start, end });
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
    let literalIndex = 0;
    let cursor = 0;
    let changed = false;
    const parts: string[] = [];
    const followups = new Map<string, string>();
    for (const replacement of replacements) {
      while ((literals[literalIndex]?.end ?? Infinity) <= replacement.start) literalIndex += 1;
      const literal = literals[literalIndex];
      if (literal !== undefined && literal.start <= replacement.start) continue;
      parts.push(source.slice(cursor, replacement.start), replacement.markdown);
      if (replacement.followup !== undefined)
        followups.set(replacement.followup.href, replacement.followup.label);
      cursor = replacement.end;
      changed = true;
    }
    if (!changed) return;
    parts.push(source.slice(cursor));
    // 只重解析实际包含标记的当前块，保留持久化分块树的历史节点与流式预算。
    const markdown = parts.join("");
    file.value = markdown;
    const result = this.parse(markdown);
    const cleanLabel = (nodes: MarkdownNode[]): MarkdownNode[] =>
      nodes.flatMap((node) => {
        // 建议按钮中的内联链接只保留文字和格式，避免按钮里嵌套另一个导航控件。
        delete node.position;
        if (node.children !== undefined) node.children = cleanLabel(node.children);
        if (node.type === "link" || node.type === "linkReference") return node.children ?? [];
        if (node.type === "html") node.type = "inlineCode";
        return [node];
      });
    const restoreLabels = (node: MarkdownNode) => {
      const label =
        node.type === "link" && node.url !== undefined ? followups.get(node.url) : undefined;
      if (label !== undefined) {
        // 先使用稳定占位链接，再独立解析标签；任意内联 Markdown 不会破坏外层建议入口。
        const inline =
          this.parse(`x${normalizeMarkdownEmphasisBoundaries(label)}`).children?.[0]?.children ??
          [];
        const first = inline[0];
        if (first?.type === "text" && first.value !== undefined) first.value = first.value.slice(1);
        node.children = cleanLabel(inline);
        return;
      }
      node.children?.forEach(restoreLabels);
    };
    restoreLabels(result);
    return result;
  };
}
