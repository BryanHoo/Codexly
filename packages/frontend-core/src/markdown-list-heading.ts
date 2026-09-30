const BOLD_TITLE = /^ {0,3}(?:\*\*[^*\r\n]+\*\*|__[^_\r\n]+__)[ \t]*\r?$/u;
const CONTINUED_LIST_ITEM = /^ {0,3}(?:[2-9]|[1-9]\d+)[.)][ \t]+/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const POSSIBLE_BOUNDARY = /(?:\*\*|__)[^\r\n]*\r?\n {0,3}(?:[2-9]|[1-9]\d+)[.)][ \t]/u;

export function separateBoldTitleFromNumberedList(markdown: string): string {
  if (!POSSIBLE_BOUNDARY.test(markdown)) return markdown;

  const lines = markdown.split("\n");
  const output: string[] = [];
  let fenceMarker = "";
  let previousTitle = false;

  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fenceMarker) fenceMarker = marker;
      else if (
        marker.startsWith(fenceMarker.charAt(0)) &&
        marker.length >= fenceMarker.length &&
        /^ {0,3}(?:`+|~+)[ \t]*\r?$/u.test(line)
      )
        fenceMarker = "";
    }

    // 非首项编号不能中断段落；只给独立标题补段落边界，保留代码原文。
    if (!fenceMarker && previousTitle && CONTINUED_LIST_ITEM.test(line)) {
      output.push(output.at(-1)?.endsWith("\r") ? "\r" : "");
    }
    output.push(line);
    previousTitle = !fenceMarker && BOLD_TITLE.test(line);
  }

  return output.join("\n");
}
