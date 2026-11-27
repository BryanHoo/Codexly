import type { AgentItem, AgentTurn } from "@/protocol/index.js";
import { isAssistantProcessMessage, isAsyncQuestionMessage, isCompactionOrTransientActivity, resolveInterruptedTurnProcessItemIds, resolveFinalAnswerIndex } from "@codexly/frontend-core";

export function resolveCompletedTurnProcessItemIds(
  items: readonly AgentItem[],
  turnStatus: AgentTurn["status"],
  hasNextSubmission = false,
  independentFileDiffs = false,
  inferUnphased = false,
): string[] {
  const interruptedItems = resolveInterruptedTurnProcessItemIds(items, turnStatus, hasNextSubmission);
  if (interruptedItems !== undefined) {
    const fileIds = independentFileDiffs ? new Set(items.filter(item => item.type === "file_change").map(item => item.id)) : undefined;
    return fileIds === undefined ? interruptedItems : interruptedItems.filter(id => !fileIds.has(id));
  }
  if (turnStatus === "running") {
    return [];
  }
  const finalAnswerIndex = resolveFinalAnswerIndex(items, inferUnphased);

  const initialUserItemId = items.find(
    (item) => item.type === "review" || (item.type === "message" && item.role === "user"),
  )?.id;

  return items.flatMap((item, index) => {
    if (isCompactionOrTransientActivity(item)) return [item.id];
    // 独立差异只在运行中直接展示；完成后统一收入过程，兼容无最终答复和迟到文件事件。
    if (independentFileDiffs && item.type === "file_change") return [item.id];
    // 问题始终属于完成态过程，包括没有最终答复或问题位于答复之后的回合。
    if (isAsyncQuestionMessage(item)) return [item.id];
    if (index >= finalAnswerIndex) return [];
    if (item.type === "message") {
      const isAssistantCommentary = isAssistantProcessMessage(item, inferUnphased);
      // 首条用户项是 Turn 入口；后续用户消息均为运行中引导，完成后归入执行过程。
      const isInTurnUserMessage = item.role === "user" && item.id !== initialUserItemId;
      return isAssistantCommentary || isInTurnUserMessage ? [item.id] : [];
    }
    // File Change 继续由最终摘要统一展示。
    return item.type === "file_change" || item.type === "review" ? [] : [item.id];
  });
}
