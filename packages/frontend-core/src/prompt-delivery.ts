import type { AgentTurn } from "@codexly/protocol";

/** 已知回合的权威终态优先于本地占位，缺少助手输出也不能继续计时。 */
export function hasPromptTurnFinished(turnStatus: AgentTurn["status"] | undefined): boolean {
  return turnStatus !== undefined && turnStatus !== "running";
}

/** 两端共用投递确认规则；缺失回合仍需等待，权威终态则结束待发送提示。 */
export function hasPromptDeliveryFinished(
  previousUserMessageIds: readonly string[],
  currentUserMessageIds: readonly string[],
  turnStatus: AgentTurn["status"] | undefined,
): boolean {
  if (hasPromptTurnFinished(turnStatus)) return true;
  const previousIds = new Set(previousUserMessageIds);
  return currentUserMessageIds.some((id) => !previousIds.has(id));
}
