import type { AgentTurn } from "@codexly/protocol";

/** 两端共用投递确认规则；缺失回合仍需等待，权威终态则结束待发送提示。 */
export function hasPromptDeliveryFinished(
  previousUserMessageIds: readonly string[],
  currentUserMessageIds: readonly string[],
  turnStatus: AgentTurn["status"] | undefined,
): boolean {
  if (turnStatus !== undefined && turnStatus !== "running") return true;
  const previousIds = new Set(previousUserMessageIds);
  return currentUserMessageIds.some((id) => !previousIds.has(id));
}
