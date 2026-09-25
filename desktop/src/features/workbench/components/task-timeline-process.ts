import type { AgentItem, AgentTurn } from "@/protocol/index.js";

export function resolveCompletedTurnProcessItemIds(
  items: readonly AgentItem[],
  turnStatus: AgentTurn["status"],
): string[] {
  if (turnStatus === "running") {
    return [];
  }
  const finalAnswerIndex = items.findLastIndex(
    (item) => item.type === "message" && item.role === "assistant" && item.phase === "final_answer",
  );
  if (finalAnswerIndex < 0) {
    return [];
  }

  const initialUserItemId = items.find(
    (item) => item.type === "review" || (item.type === "message" && item.role === "user"),
  )?.id;

  return items.slice(0, finalAnswerIndex).flatMap((item) => {
    if (item.type === "message") {
      const isAssistantCommentary = item.role === "assistant" && item.phase === "commentary";
      // 首条用户项是 Turn 入口；后续用户消息均为运行中引导，完成后归入执行过程。
      const isInTurnUserMessage = item.role === "user" && item.id !== initialUserItemId;
      return isAssistantCommentary || isInTurnUserMessage ? [item.id] : [];
    }
    // 瞬时活动完成后不进入历史过程；File Change 继续由最终摘要统一展示。
    return item.type === "file_change" ||
      item.type === "review" ||
      (item.type === "activity" && item.transient === true)
      ? []
      : [item.id];
  });
}
