export type PromptCommandTrigger = Readonly<{
  start: number;
  end: number;
  query: string;
  trigger: "/" | "#";
}>;

/** 两端共用光标触发规则；只识别开头或空白后的入口，避免路径、URL 和 Markdown 标题误触发。 */
export function resolvePromptCommandTrigger(
  draft: string,
  cursorPosition: number,
): PromptCommandTrigger | null {
  if (cursorPosition < 0 || cursorPosition > draft.length) return null;
  const before = draft.slice(0, cursorPosition);
  const start = Math.max(before.lastIndexOf("/"), before.lastIndexOf("#"));
  const preceding = before[start - 1];
  if (start < 0 || (preceding !== undefined && !/\s/u.test(preceding))) return null;
  const query = before.slice(start + 1);
  // 标题允许内部空格；前后空白或换行意味着普通正文，不能扩大替换范围。
  if (query !== query.trim() || /[\r\n]/u.test(query)) return null;
  return { start, end: cursorPosition, query, trigger: before[start] as "/" | "#" };
}
