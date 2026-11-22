import type { ToolCallContent } from "@agentclientprotocol/sdk/unstable";
import type { AgentItem } from "@codexly/protocol";
type Change = Extract<AgentItem, { type: "file_change" }>["changes"][number];

/** v1 Diff 提供修改前后正文。空 newText 可能是清空文件，不能推断为删除。 */
export function projectAcpFileChanges(content: ToolCallContent[] | null, budget: number): Change[] {
  const changes = new Map<string, Change>();
  for (const block of content ?? []) {
    if (block.type !== "diff" || !block.path || block.path.length > 4096) continue;
    if (!changes.has(block.path) && changes.size >= 128) continue;
    const kind = block.oldText == null ? "create" : "update";
    // 使用有界全文补丁，超过预算时仍保留权威路径，避免复制超大工具正文。
    let diff = "";
    if ((block.oldText?.length ?? 0) + block.newText.length <= Math.min(budget, 64 * 1024)) {
      const oldLines = block.oldText ? block.oldText.split("\n") : [];
      const newLines = block.newText ? block.newText.split("\n") : [];
      const candidate =
        `--- ${block.path}\n+++ ${block.path}\n@@ -1,${String(oldLines.length)} +1,${String(newLines.length)} @@\n` +
        oldLines.map((line) => "-" + line).join("\n") +
        "\n" +
        newLines.map((line) => "+" + line).join("\n");
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
