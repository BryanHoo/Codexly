import type { AgentItem, AgentTurn } from "@codexly/protocol";
import {
  isAssistantProcessMessage,
  isAsyncQuestionMessage,
  resolveInterruptedTurnProcessItemIds,
} from "@codexly/frontend-core";

export function resolveCompletedTurnProcessItemIds(
  items: readonly AgentItem[],
  turnStatus: AgentTurn["status"],
  hasNextSubmission = false,
): string[] {
  const interruptedItems = resolveInterruptedTurnProcessItemIds(
    items,
    turnStatus,
    hasNextSubmission,
  );
  if (interruptedItems !== undefined) return interruptedItems;
  if (turnStatus === "running") {
    return [];
  }
  const finalAnswerIndex = items.findLastIndex(
    (item) =>
      item.type === "message" &&
      item.role === "assistant" &&
      item.phase === "final_answer" &&
      !isAsyncQuestionMessage(item),
  );

  return items.flatMap((item, index) => {
    // 压缩等瞬时活动属于执行过程，不能因缺少完成事件或最终答复阶段而漏在结果区。
    if (item.type === "activity" && item.transient === true) return [item.id];
    // 问题始终属于完成态过程，包括没有最终答复或问题位于答复之后的回合。
    if (isAsyncQuestionMessage(item)) return [item.id];
    if (index >= finalAnswerIndex) return [];
    if (item.type === "message") {
      return isAssistantProcessMessage(item) ? [item.id] : [];
    }
    // File Change 继续由最终摘要统一展示。
    return item.type === "file_change" || item.type === "review" ? [] : [item.id];
  });
}
