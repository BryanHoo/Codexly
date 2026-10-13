import {
  findAssistantDirectives,
  parseAssistantDirective,
  type DirectiveScanBudget,
} from "./assistant-directives.js";

const NAMES = [
  "codex-file-citation",
  "codex-followup",
  "codex-inline-vis",
  "codex-realtime-inline",
  "code-comment",
  "git-stage",
  "git-commit",
  "git-create-branch",
  "git-push",
  "git-create-pr",
];
const START = /:{1,3}(?:codex-[\w-]+|git-[\w-]+|code-comment)(?=\{|\[)/gu;

// null 表示普通冒号，-1 表示仍在流式等待的指令；完整指令返回原文结束位置。
export function assistantDirectiveEnd(
  source: string,
  start: number,
  budget: DirectiveScanBudget = { remaining: source.length * 4 },
): number | null {
  let cursor = start;
  while (source[cursor] === ":" && cursor - start < 4) cursor += 1;
  if (cursor - start > 3) return null;
  const suffix = source.slice(cursor);
  if (NAMES.some((name) => name.startsWith(suffix))) return -1;
  if (
    !NAMES.some(
      (name) =>
        suffix.startsWith(`${name}{`) ||
        (name === "codex-followup" && suffix.startsWith(`${name}[`)),
    )
  )
    return null;
  const literalFirst = suffix.startsWith("codex-file-citation{") || suffix.startsWith("git-");
  const directive =
    parseAssistantDirective(source, start, literalFirst ? "literal" : "backslash", budget) ??
    parseAssistantDirective(source, start, literalFirst ? "backslash" : "literal", budget);
  return directive?.end ?? -1;
}

export function assistantDirectiveSpans(source: string): { start: number; end: number }[] {
  if (!source.includes(":")) return [];
  const spans = findAssistantDirectives(source).map(({ start, end }) => ({ start, end }));
  const budget = { remaining: source.length * 4 };
  for (const match of source.matchAll(START)) {
    const end = assistantDirectiveEnd(source, match.index, budget);
    if (end === -1) spans.push({ start: match.index, end: source.length });
  }
  return spans;
}
