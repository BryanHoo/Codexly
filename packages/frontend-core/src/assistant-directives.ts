export type AssistantDirective = Readonly<{
  start: number;
  end: number;
  name: string;
  label: string | null;
  attributes: ReadonlyMap<string, string>;
}>;
export interface DirectiveScanBudget {
  remaining: number;
}
type QuoteMode = "literal" | "backslash";
const NAME_CHARACTER = /[\w-]/u;

export function parseAssistantDirective(
  source: string,
  start = 0,
  mode: QuoteMode = "backslash",
  budget: DirectiveScanBudget = { remaining: source.length * 4 },
): AssistantDirective | null {
  let cursor = start;
  const advance = () => {
    cursor += 1;
    budget.remaining -= 1;
  };
  while (source[cursor] === ":" && budget.remaining > 0) advance();
  if (cursor - start < 1 || cursor - start > 3) return null;
  const nameStart = cursor;
  if (!/[a-z]/iu.test(source[cursor] ?? "")) return null;
  while (NAME_CHARACTER.test(source[cursor] ?? "") && budget.remaining > 0) advance();
  const name = source.slice(nameStart, cursor);
  let label: string | null = null;
  if (source[cursor] === "[") {
    if (name !== "codex-followup") return null;
    advance();
    const labelStart = cursor;
    let depth = 1;
    let codeTicks = 0;
    let codeStart = cursor;
    while (depth > 0 && budget.remaining > 0) {
      const character = source[cursor];
      if (character === undefined || character === "\n" || character === "\r") {
        // 未配对反引号是普通文字；回放其后内容，恢复方括号的边界含义。
        if (codeTicks === 0) return null;
        cursor = codeStart;
        codeTicks = 0;
        continue;
      }
      if (character === "`") {
        const tickStart = cursor;
        while (source[cursor] === "`" && budget.remaining > 0) advance();
        const ticks = cursor - tickStart;
        if (codeTicks === 0) {
          codeTicks = ticks;
          codeStart = cursor;
        } else if (codeTicks === ticks) codeTicks = 0;
        continue;
      }
      if (codeTicks === 0) {
        if (character === "\\") {
          advance();
          if (source[cursor] === undefined || /[\r\n]/u.test(source[cursor] ?? "")) return null;
        } else if (character === "[") depth += 1;
        else if (character === "]") depth -= 1;
      }
      if (depth > 0) advance();
    }
    if (depth !== 0) return null;
    label = source.slice(labelStart, cursor);
    advance();
  }
  if (source[cursor] !== "{") return null;
  advance();
  const attributes = new Map<string, string>();
  const skipSpace = () => {
    while ((source[cursor] === " " || source[cursor] === "\t") && budget.remaining > 0) advance();
  };
  while (cursor < source.length && budget.remaining > 0) {
    skipSpace();
    if (source[cursor] === "}") return { start, end: cursor + 1, name, label, attributes };
    const keyStart = cursor;
    while (NAME_CHARACTER.test(source[cursor] ?? "") && budget.remaining > 0) advance();
    if (cursor === keyStart) return null;
    const key = source.slice(keyStart, cursor);
    // 官方语法拒绝重复属性，避免显示的标签与实际动作参数发生歧义。
    if (attributes.has(key)) return null;
    skipSpace();
    if (source[cursor] !== "=") return null;
    advance();
    skipSpace();
    const quote = source[cursor];
    let value: string;
    if (quote === '"' || quote === "'") {
      advance();
      const valueStart = cursor;
      while (cursor < source.length && source[cursor] !== quote && budget.remaining > 0) {
        if (/[\r\n]/u.test(source[cursor] ?? "")) return null;
        if (mode === "backslash" && source[cursor] === "\\" && source[cursor + 1] === quote)
          advance();
        advance();
      }
      if (source[cursor] !== quote || budget.remaining <= 0) return null;
      value = source.slice(valueStart, cursor);
      if (mode === "backslash") value = value.replaceAll(`\\${quote}`, quote);
      advance();
    } else {
      const valueStart = cursor;
      while (cursor < source.length && !/[\s}]/u.test(source[cursor] ?? "") && budget.remaining > 0)
        advance();
      if (cursor === valueStart) return null;
      value = source.slice(valueStart, cursor);
    }
    attributes.set(key, value);
  }
  return null;
}

export function findAssistantDirectives(source: string): AssistantDirective[] {
  const result: AssistantDirective[] = [];
  const pattern = /:{1,3}[a-z][\w-]*(?:\{|\[)/giu;
  // 两种引号模式各自共享线性预算；格式错误的候选不能反复扫描整段回复。
  const budgets = {
    literal: { remaining: source.length * 4 },
    backslash: { remaining: source.length * 4 },
  };
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const start = match.index;
    if (source[start - 1] === ":") continue;
    let slashes = 0;
    for (let index = start - 1; source[index] === "\\"; index -= 1) slashes += 1;
    if (slashes % 2 !== 0) continue;
    const literalFirst = match[0].includes("codex-file-citation") || match[0].includes("git-");
    const modes: QuoteMode[] = literalFirst ? ["literal", "backslash"] : ["backslash", "literal"];
    const directive =
      parseAssistantDirective(source, start, modes[0], budgets[modes[0] ?? "literal"]) ??
      parseAssistantDirective(source, start, modes[1], budgets[modes[1] ?? "backslash"]);
    if (directive !== null) {
      result.push(directive);
      // 连未知指令也保留完整边界，禁止执行其隐藏属性中的嵌套指令。
      pattern.lastIndex = directive.end;
    }
  }
  return result;
}

export function isLocalDirectivePath(path: string | undefined): path is string {
  return (
    path !== undefined &&
    path.trim() !== "" &&
    !/[\0\r\n]/u.test(path) &&
    !/^[a-z][a-z\d+.-]+:/iu.test(path)
  );
}
