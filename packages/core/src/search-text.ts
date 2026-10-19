export function* searchTextMatches(
  text: string,
  query: string,
): Generator<{ start: number; end: number }> {
  // Unicode 小写映射可能改变长度；记录原文 UTF-16 范围，避免 emoji 或 İ 导致高亮偏移。
  const folded = text.toLowerCase();
  const characters = text[Symbol.iterator]();
  let foldedEnd = 0;
  let originalStart = 0;
  let originalEnd = 0;
  const locate = (position: number) => {
    while (foldedEnd <= position) {
      const character = characters.next().value;
      if (character === undefined) throw new Error("Search text range is invalid");
      originalStart = originalEnd;
      originalEnd += character.length;
      foldedEnd += character.toLowerCase().length;
    }
    return { start: originalStart, end: originalEnd };
  };
  const needle = query.toLowerCase();
  let index = folded.indexOf(needle);
  while (index >= 0) {
    const start = locate(index).start;
    yield { start, end: locate(index + needle.length - 1).end };
    index = folded.indexOf(needle, index + needle.length);
  }
}

export function searchTextSnippet(text: string, start: number, end: number) {
  // 摘要只遍历命中附近的字符，避免为长消息复制完整前缀和后缀数组。
  let beforeStart = start;
  let afterEnd = end;
  for (let count = 0; count < 48 && beforeStart > 0; count += 1) {
    beforeStart -= 1;
    const code = text.charCodeAt(beforeStart);
    if (beforeStart > 0 && code >= 0xdc00 && code <= 0xdfff) beforeStart -= 1;
  }
  for (let count = 0; count < 96 && afterEnd < text.length; count += 1) {
    afterEnd += (text.codePointAt(afterEnd) ?? 0) > 0xffff ? 2 : 1;
  }
  const before = text.slice(beforeStart, start);
  const after = text.slice(end, afterEnd);
  const prefix = before.length < start ? "…" : "";
  return {
    snippet:
      prefix +
      before +
      text.slice(start, end) +
      after +
      (end + after.length < text.length ? "…" : ""),
    snippetMatchRange: {
      start: prefix.length + before.length,
      end: prefix.length + before.length + end - start,
    },
  };
}
