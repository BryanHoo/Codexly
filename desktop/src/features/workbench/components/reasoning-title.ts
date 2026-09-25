export function reasoningTitle(text: string, fallback: string): string {
  const line = text.split("\n").find((part) => part.trim().length > 0);
  if (line === undefined) return fallback;
  // 标题只需单行纯文本；正文仍由 Markdown 组件完整解析。
  const title = line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/(\*{1,3}|_{1,3}|~~|`+)(.*?)\1/g, "$2")
    .replace(/(\*{1,3}|_{1,3}|~~|`+)(.*?)\1/g, "$2")
    .replace(/\\([^\w\s])/g, "$1")
    .trim();
  return title || fallback;
}
