import type { AgentItem, AgentTurn } from "@/protocol/index.js";
import { isAssistantProcessMessage, isAsyncQuestionMessage, resolveInterruptedTurnProcessItemIds } from "@codexly/frontend-core";

export function resolveCompletedTurnProcessItemIds(
  items: readonly AgentItem[],
  turnStatus: AgentTurn["status"],
  hasNextSubmission = false,
  independentFileDiffs = false,
): string[] {
  const interruptedItems = resolveInterruptedTurnProcessItemIds(items, turnStatus, hasNextSubmission);
  if (interruptedItems !== undefined) {
    const fileIds = independentFileDiffs ? new Set(items.filter(item => item.type === "file_change").map(item => item.id)) : undefined;
    return fileIds === undefined ? interruptedItems : interruptedItems.filter(id => !fileIds.has(id));
  }
  if (turnStatus === "running") {
    return [];
  }
  const finalAnswerIndex = items.findLastIndex(
    (item) => item.type === "message" && item.role === "assistant" && item.phase === "final_answer" && !isAsyncQuestionMessage(item),
  );

  const initialUserItemId = items.find(
    (item) => item.type === "review" || (item.type === "message" && item.role === "user"),
  )?.id;

  return items.flatMap((item, index) => {
    // 独立差异只在运行中直接展示；完成后统一收入过程，兼容无最终答复和迟到文件事件。
    if (independentFileDiffs && item.type === "file_change") return [item.id];
    // 压缩等瞬时活动属于执行过程，不能因缺少完成事件或最终答复阶段而漏在结果区。
    if (item.type === "activity" && item.transient === true) return [item.id];
    // 问题始终属于完成态过程，包括没有最终答复或问题位于答复之后的回合。
    if (isAsyncQuestionMessage(item)) return [item.id];
    if (index >= finalAnswerIndex) return [];
    if (item.type === "message") {
      const isAssistantCommentary = isAssistantProcessMessage(item);
      // 首条用户项是 Turn 入口；后续用户消息均为运行中引导，完成后归入执行过程。
      const isInTurnUserMessage = item.role === "user" && item.id !== initialUserItemId;
      return isAssistantCommentary || isInTurnUserMessage ? [item.id] : [];
    }
    // File Change 继续由最终摘要统一展示。
    return item.type === "file_change" || item.type === "review" ? [] : [item.id];
  });
}
