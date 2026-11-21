type PatchKind = "create" | "delete" | "update";

const properHunk = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u;
const fragmentHunk = /^@@(?: (?![-+@])([^\r\n]+))?\r?$/u;
const noNewlineMarker = /^\\ No newline at end of file\r?$/u;

function normalizeFragment(lines: readonly string[]): string {
  const patch: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  let context = "";
  let body: string[] = [];
  let oldCount = 0;
  let newCount = 0;

  function flushHunk() {
    if (oldCount + newCount === 0) return;
    // 流式片段没有原文件行号，按片段顺序生成局部行号以供预览。
    const oldStart = oldCount === 0 ? oldLine - 1 : oldLine;
    const newStart = newCount === 0 ? newLine - 1 : newLine;
    patch.push(
      `@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@${context}`,
      body.join("\n"),
    );
    oldLine += oldCount;
    newLine += newCount;
    oldCount = 0;
    newCount = 0;
    body = [];
  }

  for (const line of lines) {
    const marker = fragmentHunk.exec(line);
    if (marker !== null) {
      flushHunk();
      context = marker[1] === undefined ? "" : ` ${marker[1]}`;
    } else if (line !== "*** End of File" && line !== "*** End of File\r") {
      if (noNewlineMarker.test(line)) {
        body.push(line);
        continue;
      }
      if (!line.startsWith("+")) oldCount += 1;
      if (!line.startsWith("-")) newCount += 1;
      body.push(/^[+\- ]/u.test(line) ? line : ` ${line}`);
    }
  }
  flushHunk();
  return patch.join("\n");
}

export function normalizeFileChangePatch({
  diff,
  kind,
  path,
}: Readonly<{ diff: string; kind: PatchKind; path: string }>): string {
  if (diff.length === 0 || /^(?:Binary files .* differ|GIT binary patch)\r?$/mu.test(diff)) {
    return diff;
  }

  const firstHunkIndex = diff.search(/^@@(?: |\r?$)/mu);
  const header = firstHunkIndex === -1 ? diff : diff.slice(0, firstHunkIndex);
  // 文件头必须相邻且出现在 hunk 前，正文中的 ---/+++ 仍然属于代码。
  const hasHeaders = /^--- [^\n]+\n\+\+\+ [^\n]+/mu.test(header);
  if (hasHeaders && (firstHunkIndex === -1 || properHunk.test(diff.slice(firstHunkIndex)))) {
    return diff;
  }
  if (firstHunkIndex === -1 && diff.startsWith("diff --git ")) return diff;

  const normalizedPath = path
    .replace(/^[/\\]+/u, "")
    .replaceAll("\\", "/")
    .replace(/[\r\n\t]/gu, "_");
  const before = kind === "create" ? "/dev/null" : `a/${normalizedPath}`;
  const after = kind === "delete" ? "/dev/null" : `b/${normalizedPath}`;
  const fileHeaders = `--- ${before}\n+++ ${after}\n`;
  const body = firstHunkIndex === -1 ? diff : diff.slice(firstHunkIndex);
  if (properHunk.test(body)) return fileHeaders + body;

  // 完整 Unified Diff 交给渲染器验证；仅补齐已知的逐行和 apply_patch 预览格式。
  if (firstHunkIndex !== -1 && !fragmentHunk.test(body.split("\n", 1)[0] ?? "")) return diff;
  if (!/^[+-]/mu.test(body)) return diff;
  const lines = body.split("\n");
  // 只去掉末尾换行产生的空数组项，保留 hunk 中的空白上下文和尾部空格。
  if (body.endsWith("\n")) lines.pop();
  return (hasHeaders ? header : fileHeaders) + normalizeFragment(lines);
}
