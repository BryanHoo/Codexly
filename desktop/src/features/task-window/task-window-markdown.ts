import { Lexer, type Token, type Tokens } from "marked";
import remend from "remend";
import { splitUnparsedStrong } from "../../shared/lib/markdown-strong.js";

export type InlineMark = "strong" | "em" | "del" | "code" | "link";
export type InlineRun = Readonly<{ text: string; marks: readonly InlineMark[] }>;
export type PreviewBlock = Readonly<{
  kind: "paragraph" | "heading" | "list" | "quote" | "code" | "rule" | "table";
  runs: readonly InlineRun[];
  prefix?: string;
  continuation?: boolean;
  level?: number;
}>;

function inline(tokens: readonly Token[], marks: readonly InlineMark[] = []): InlineRun[] {
  return tokens.flatMap((token): InlineRun[] => {
    if (token.type === "html") return [];
    if (token.type === "br") return [{ text: "\n", marks }];
    if (token.type === "strong" || token.type === "em" || token.type === "del" || token.type === "link") {
      return inline(token.tokens ?? [], [...marks, token.type]);
    }
    if (token.type === "codespan") return [{ text: token.text, marks: [...marks, "code"] }];
    if ("tokens" in token && token.tokens) return inline(token.tokens, marks);
    // 与主会话共享文本修复规则；代码及 escape Token 不参与二次解析。
    if (token.type === "text" && token.raw === token.text) {
      const parts = splitUnparsedStrong(token.text);
      if (parts) return parts.map((part) => ({ text: part.text, marks: part.strong ? [...marks, "strong"] : marks }));
    }
    return "text" in token ? [{ text: token.text, marks }] : [];
  });
}

// 按解析后的行内片段分块，粗体/代码等样式跨块保留；巨型单段和长代码行也能被虚拟卸载。
function bounded(block: PreviewBlock): PreviewBlock[] {
  const result: PreviewBlock[] = [];
  let runs: InlineRun[] = [];
  let size = 0;
  for (const run of block.runs) {
    const characters = Array.from(run.text);
    for (let offset = 0; offset < characters.length;) {
      const count = Math.min(240 - size, characters.length - offset);
      runs.push({ text: characters.slice(offset, offset + count).join(""), marks: run.marks });
      offset += count;
      size += count;
      if (size === 240) {
        result.push({ ...block, runs, continuation: result.length > 0 });
        runs = []; size = 0;
      }
    }
  }
  if (runs.length || result.length === 0) result.push({ ...block, runs, continuation: result.length > 0 });
  return result;
}

function blocks(tokens: readonly Token[], quoted = false): PreviewBlock[] {
  return tokens.flatMap((token): PreviewBlock[] => {
    switch (token.type) {
      case "space": case "html": case "def": return [];
      case "hr": return [{ kind: "rule", runs: [] }];
      case "blockquote": return blocks(token.tokens ?? [], true);
      case "code": return token.text.split("\n").flatMap((line: string) => bounded({ kind: "code", runs: [{ text: line || " ", marks: [] }] }));
      case "list": return token.items.flatMap((item: Tokens.ListItem, index: number) => {
        const prefix = item.task ? (item.checked ? "✓" : "○") : token.ordered ? `${Number(token.start) + index}.` : "•";
        return blocks(item.tokens).map((block, offset) => ({ ...block, kind: "list" as const, prefix: offset === 0 ? prefix : "" }));
      });
      case "table": return [token.header, ...token.rows].flatMap((cells, index) => bounded({
        kind: "table", runs: cells.flatMap((cell: Tokens.TableCell, column: number) => [
          ...(column ? [{ text: "  │  ", marks: [] }] : []),
          ...inline(cell.tokens, index === 0 ? ["strong"] : []),
        ]),
      }));
      default: {
        const content = "tokens" in token && token.tokens ? inline(token.tokens) : "text" in token ? [{ text: token.text, marks: [] }] : [];
        if (content.length === 0) return [];
        return bounded({ kind: token.type === "heading" ? "heading" : quoted ? "quote" : "paragraph", level: token.type === "heading" ? token.depth : undefined, runs: content });
      }
    }
  });
}

export function parseTaskWindowMarkdown(text: string): PreviewBlock[] {
  // 复用主 Markdown 引擎的 lexer 与流式补全器；只生成 React 文本，不解析 HTML、不下载媒体。
  return blocks(Lexer.lex(remend(text), { gfm: true }));
}
