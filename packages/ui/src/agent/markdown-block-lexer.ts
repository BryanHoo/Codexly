import { Lexer } from "marked";

const FOOTNOTE = /\[\^[\w-]{1,200}\]/;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function tagBalance(source: string, tag: string): { opened: number; closed: number } {
  const opened = VOID_TAGS.has(tag)
    ? 0
    : (source.match(new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, "gi")) ?? []).filter(
        (match) => !match.trimEnd().endsWith("/>"),
      ).length;
  const closed = (source.match(new RegExp(`</${tag}(?=[\\s>])[^>]*>`, "gi")) ?? []).length;
  return { opened, closed };
}

function hasOpenMath(source: string): boolean {
  let delimiters = 0;
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] === "$" && source[index + 1] === "$") {
      delimiters += 1;
      index += 1;
    }
  }
  return delimiters % 2 === 1;
}

// 与 Streamdown 的分块契约保持一致；直接依赖同版本 marked，避免 Worker 加载 React/DOM。
// 主线程和 Worker 共用此入口，对照测试锁住列表、HTML、数学公式及脚注的语义。
export function parseMarkdownBlocks(source: string): string[] {
  if (FOOTNOTE.test(source)) return [source];
  const blocks: string[] = [];
  const openTags: string[] = [];
  let previousWasCode = false;
  for (const token of Lexer.lex(source, { gfm: true })) {
    const last = blocks.length - 1;
    const tag = openTags.at(-1);
    if (tag !== undefined) {
      blocks[last] = (blocks[last] ?? "") + token.raw;
      const { opened, closed } = tagBalance(token.raw, tag);
      for (let index = 0; index < opened; index += 1) openTags.push(tag);
      for (let index = 0; index < closed && openTags.at(-1) === tag; index += 1) openTags.pop();
      continue;
    }
    if (token.type === "html" && token.block) {
      const name = /<(\w+)[\s>]/.exec(token.raw)?.[1]?.toLowerCase();
      if (name !== undefined) {
        const { opened, closed } = tagBalance(token.raw, name);
        if (opened > closed) openTags.push(name);
      }
    }
    // lexer 可能把跨空行公式拆成多个 token；代码块里的 $$ 不参与合并。
    if (last >= 0 && !previousWasCode && hasOpenMath(blocks[last] ?? "")) {
      blocks[last] = (blocks[last] ?? "") + token.raw;
      continue;
    }
    blocks.push(token.raw);
    if (token.type !== "space") previousWasCode = token.type === "code";
  }
  return blocks;
}
