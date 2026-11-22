import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentContextUsage } from "@codexly/protocol";

/** ACP 报告当前上下文占用而非累计消耗；零容量按共享协议表示为未知，费用不混入 token。 */
export function acpContextUsage(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): AgentContextUsage {
  return { usedTokens: update.used, contextWindow: update.size > 0 ? update.size : null };
}
