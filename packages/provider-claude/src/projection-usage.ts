import type { AgentContextUsage } from "@codexly/protocol";

/** SDK 暂无统计时保留最近有效用量；相同统计返回空值，避免重复发布事件。 */
export function changedClaudeUsage(
  current: AgentContextUsage | null,
  usage: AgentContextUsage,
): AgentContextUsage | undefined {
  if (usage.usedTokens === 0 && current && current.usedTokens > 0)
    usage = { ...usage, usedTokens: current.usedTokens };
  if (current?.usedTokens === usage.usedTokens && current.contextWindow === usage.contextWindow)
    return undefined;
  return usage;
}
