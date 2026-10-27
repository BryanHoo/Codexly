import type { AgentTurn } from "@codexly/protocol";

/** 已知回合的权威终态优先于本地占位，缺少助手输出也不能继续计时。 */
export function hasPromptTurnFinished(turnStatus: AgentTurn["status"] | undefined): boolean {
  return turnStatus !== undefined && turnStatus !== "running";
}

// 只依赖两端共有的消息字段，桌面和 Web 的 reasoning 等其他条目结构可以不同。
type DeliveryItem = Readonly<{
  id: string;
  type: string;
  role?: string;
  text?: string;
  identityAliases?: readonly string[];
  attachments?: readonly { id: string }[];
  skills?: readonly { name: string }[];
}>;

type DeliveredPrompt = Readonly<{
  text: string;
  attachmentIds: readonly string[];
  skillNames: readonly string[];
}>;

function sameValues(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length !== actual.length) return false;
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

/** 引导与异步回答共用确认规则：仅由本次输入的真实用户消息或回合终态解除等待。 */
export function hasPromptDeliveryFinished(
  previousUserMessageIds: readonly string[],
  items: readonly DeliveryItem[],
  turnStatus: AgentTurn["status"] | undefined,
  prompt: DeliveredPrompt,
): boolean {
  if (hasPromptTurnFinished(turnStatus)) return true;
  const previousIds = new Set(previousUserMessageIds);
  return items.some((item) => {
    if (item.type !== "message" || item.role !== "user" || typeof item.text !== "string")
      return false;
    // 历史快照可能换用原生 ID；旧消息的别名也不能被当成本次新回执。
    if (previousIds.has(item.id) || item.identityAliases?.some((id) => previousIds.has(id)))
      return false;
    return (
      item.text.trim() === prompt.text.trim() &&
      sameValues(
        prompt.attachmentIds,
        (item.attachments ?? []).map(({ id }) => id),
      ) &&
      sameValues(
        prompt.skillNames,
        (item.skills ?? []).map(({ name }) => name),
      )
    );
  });
}
