import type { AgentItemStatus } from "@codexly/protocol";

type TimelineItem = Readonly<{ id: string; type: string; output?: unknown }>;

export function isAcpSubagentItemId(id: string): boolean {
  return id.startsWith("acp:child:");
}

function isLaunchReceiptText(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value
      .trimStart()
      .startsWith("Async agent launched successfully. (This tool result is internal metadata")
  );
}

export function isAcpSubagentLaunchReceipt(item: TimelineItem): boolean {
  if (item.type !== "tool" || !item.id.includes("acp:tool:")) return false;
  const output: unknown = item.output;
  if (isLaunchReceiptText(output)) return true;
  // ACP 工具结果可能是原始文本，也可能是 SDK 的单段文本内容块。
  const block: unknown = Array.isArray(output) && output.length === 1 ? output[0] : output;
  if (typeof block !== "object" || block === null) return false;
  if ("type" in block && block.type === "text" && "text" in block) {
    return isLaunchReceiptText(block.text);
  }
  if ("type" in block && block.type === "content" && "content" in block) {
    const content = block.content;
    return (
      typeof content === "object" &&
      content !== null &&
      "type" in content &&
      content.type === "text" &&
      "text" in content &&
      isLaunchReceiptText(content.text)
    );
  }
  return false;
}

/** 子会话记录留在 Store 中供右栏按原生身份读取，主会话只渲染自己的执行记录。 */
export function isHiddenFromRootTimeline(item: TimelineItem): boolean {
  return (
    item.type === "acp_subagent" || isAcpSubagentItemId(item.id) || isAcpSubagentLaunchReceipt(item)
  );
}

export function getAcpSubagentStatus(state: string | undefined): AgentItemStatus {
  switch (state) {
    case "running":
    case "requires_action":
      return "running";
    case "idle":
      return "completed";
    default:
      return "pending";
  }
}
