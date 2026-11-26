import type { ToolCallContent } from "@agentclientprotocol/sdk/unstable";
import type { AgentItem } from "@codexly/protocol";
type Change = Extract<AgentItem, { type: "file_change" }>["changes"][number];

function appendHunkLines(patch: string[], text: string, prefix: "+" | "-"): number {
  if (!text) return 0;
  const lines = text.split("\n");
  const hasFinalNewline = text.endsWith("\n");
  // split 的末尾空元素只代表换行符，正文中的空行仍需携带增删前缀。
  if (hasFinalNewline) lines.pop();
  for (const line of lines) patch.push(prefix + line);
  if (!hasFinalNewline) patch.push("\\ No newline at end of file");
  return lines.length;
}

/** v1 Diff 提供修改前后正文。空 newText 可能是清空文件，不能推断为删除。 */
export function projectAcpFileChanges(content: ToolCallContent[] | null, budget: number): Change[] {
  const changes = new Map<string, Change>();
  for (const block of content ?? []) {
    if (block.type !== "diff" || !block.path || block.path.length > 4096) continue;
    if (!changes.has(block.path) && changes.size >= 128) continue;
    const kind = block.oldText == null ? "create" : "update";
    const oldText = block.oldText ?? "";
    // 使用有界全文补丁，超过预算时仍保留权威路径，避免复制超大工具正文。
    let diff = "";
    if (
      oldText.length + block.newText.length <= Math.min(budget, 64 * 1024) &&
      oldText !== block.newText
    ) {
      const patch: string[] = [];
      const removals = appendHunkLines(patch, oldText, "-");
      const additions = appendHunkLines(patch, block.newText, "+");
      // 空侧以 0 为起始行，直接拼接带前缀的正文，避免生成无前缀空行导致严格解析失败。
      const before = kind === "create" ? "/dev/null" : block.path;
      const oldRange = removals === 0 ? "0,0" : `1,${String(removals)}`;
      const newRange = additions === 0 ? "0,0" : `1,${String(additions)}`;
      const candidate = `--- ${before}\n+++ ${block.path}\n@@ -${oldRange} +${newRange} @@\n${patch.join("\n")}\n`;
      const bytes = Buffer.byteLength(candidate);
      if (bytes <= Math.min(budget, 64 * 1024)) {
        diff = candidate;
        budget -= bytes;
      }
    }
    changes.set(block.path, { path: block.path, diff, kind });
  }
  return [...changes.values()];
}
