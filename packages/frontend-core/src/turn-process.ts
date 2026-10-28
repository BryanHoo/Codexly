type ProcessMessage = Readonly<{
  type: string;
  role?: string;
  phase?: string;
  questions?: readonly unknown[];
}>;

/** 完成的修改由回复末尾统一汇总；在分组前移除不可见行，避免空动画容器累积间距。 */
export function isInlineFileChangeVisible(status: string, turnStatus: string): boolean {
  return status === "completed"
    ? turnStatus === "running"
    : status === "pending" || status === "running";
}

/** 异步问题可能使用任意消息阶段，必须以非空 questions 识别，不能当作最终答复。 */
export function isAsyncQuestionMessage(item: ProcessMessage): boolean {
  return item.type === "message" && item.role === "assistant" && (item.questions?.length ?? 0) > 0;
}

/** 完成态折叠与历史过程分页共用分类，避免展开后遗漏异步问题。 */
export function isAssistantProcessMessage(item: ProcessMessage): boolean {
  return (
    item.type === "message" &&
    item.role === "assistant" &&
    (item.phase === "commentary" || isAsyncQuestionMessage(item))
  );
}

/** 中断来源统一按回合终态处理；下一次提交前保留输出，之后连同未完成答复一起折叠。 */
export function resolveInterruptedTurnProcessItemIds(
  items: readonly { id: string; type: string; role?: string }[],
  status: string,
  hasNextSubmission: boolean,
): string[] | undefined {
  if (status !== "interrupted" && status !== "failed") return undefined;
  if (!hasNextSubmission) return [];
  // 保留用户输入和审核入口，文件变更及所有阶段的 Assistant 输出均可展开查看。
  return items.flatMap((item) =>
    item.type === "review" || (item.type === "message" && item.role === "user") ? [] : [item.id],
  );
}
