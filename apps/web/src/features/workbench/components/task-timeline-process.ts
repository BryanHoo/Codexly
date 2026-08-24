import type { AgentItem, AgentTurn } from "@codexly/protocol";

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

  return items.slice(0, finalAnswerIndex).flatMap((item) => {
    if (item.type === "message") {
      return item.role === "assistant" && item.phase === "commentary" ? [item.id] : [];
    }
    // 瞬时活动完成后不进入历史过程；File Change 继续由最终摘要统一展示。
    return item.type === "file_change" ||
      item.type === "review" ||
      (item.type === "activity" && item.transient === true)
      ? []
      : [item.id];
  });
}
