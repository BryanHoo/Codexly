import { parsePatch } from "diff";

export type LegacyDiffLine = Readonly<{
  kind: string;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}>;

export function legacyDiffLines(patch: string): LegacyDiffLine[] {
  const lines: LegacyDiffLine[] = [];
  try {
    // 使用成熟的 unified diff 解析器，避免重写 hunk 和行号规则。
    for (const file of parsePatch(patch)) {
      for (const hunk of file.hunks) {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        lines.push({ kind: "@", text: `@@ -${oldLine},${hunk.oldLines} +${newLine},${hunk.newLines} @@`, oldLine: null, newLine: null });
        for (const line of hunk.lines) {
          const kind = line[0] ?? " ";
          lines.push({
            kind,
            text: kind === "\\" ? line : line.slice(1),
            oldLine: kind === " " || kind === "-" ? oldLine++ : null,
            newLine: kind === " " || kind === "+" ? newLine++ : null,
          });
        }
      }
    }
    if (lines.length > 0) return lines;
  } catch {
    // 不完整或二进制补丁仍保留原始内容，禁止静默显示空白。
  }
  return patch.split("\n").map((text) => ({ kind: " ", text, oldLine: null, newLine: null }));
}
