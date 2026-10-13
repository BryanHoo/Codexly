import { parseAssistantDirective } from "./assistant-directives.js";

export type CodeCommentDirective = Readonly<{
  body: string;
  end: number | null;
  file: string;
  priority: number | null;
  start: number | null;
  title: string;
}>;

export function parseCodeComment(source: string): CodeCommentDirective | null {
  // 四个空格开头属于 Markdown 缩进代码；评论只接受正文里的完整独立指令。
  const indent = /^( {0,3})(?=:)/u.exec(source)?.[0].length;
  if (indent === undefined) return null;
  const directive = parseAssistantDirective(source, indent);
  if (directive?.name !== "code-comment") return null;
  const attributes = directive.attributes;
  const title = attributes.get("title");
  const body = attributes.get("body");
  const file = attributes.get("file");
  if (!title?.trim() || !body?.trim() || !file?.trim()) return null;
  const number = (name: string): number | null => {
    const value = attributes.get(name)?.replace(/^[pP]/u, "");
    if (value === undefined || !/^-?\d+$/u.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const rawStart = number("start");
  const start = rawStart === null ? null : Math.max(1, rawStart);
  const rawEnd = number("end");
  const end = rawEnd === null ? null : Math.max(start ?? 1, rawEnd);
  const rawPriority = number("priority");
  const priority =
    rawPriority !== null && rawPriority >= 0 && rawPriority <= 3 ? rawPriority : null;
  return { title, body, file, start, end, priority };
}

export function getCodeCommentRemainder(source: string): string {
  const indent = /^( {0,3})(?=:)/u.exec(source)?.[0].length;
  if (indent === undefined) return "";
  const directive = parseAssistantDirective(source, indent);
  // 仅移除评论自身，保留同一行的 Git 回执或后续正文。
  return directive === null ? "" : source.slice(directive.end);
}
