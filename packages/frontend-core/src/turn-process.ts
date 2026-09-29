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
