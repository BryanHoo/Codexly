export type StrongTextPart = Readonly<{ text: string; strong: boolean }>;

// 仅修复解析器留下的成对文本标记；代码、转义和嵌套语法仍由原解析器处理。
export function splitUnparsedStrong(text: string): StrongTextPart[] | null {
  if (!text.includes("**")) return null;
  const parts: StrongTextPart[] = [];
  const pattern = /\*\*([^\s*][^*\r\n]*?)\*\*/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    // 三重及更长标记可能属于斜体组合，不在此处重新解释。
    if (text[start - 1] === "*" || text[end] === "*") continue;
    const body = match[1]!;
    const content = body.trimEnd();
    parts.push({ text: text.slice(offset, start), strong: false });
    parts.push({ text: content, strong: true });
    // 保留原来的文字间距，仅把结束标记前的空白移出加粗范围。
    if (content.length < body.length) parts.push({ text: body.slice(content.length), strong: false });
    offset = end;
  }
  if (offset === 0) return null;
  parts.push({ text: text.slice(offset), strong: false });
  return parts.filter((part) => part.text.length > 0);
}
