type TimelineOperationType = "command" | "file_change" | "tool" | "reasoning" | "activity";

/** 文件修改由独立文件条目呈现，隐藏 ACP 重复投影的编辑工具行，历史与实时共用。 */
export function isHiddenFileEditingTool(
  item: { type: string; name?: string } | undefined,
): boolean {
  return item?.type === "tool" && item.name === "Editing files";
}

/** 两端共用操作分类：查看图片、等待虽投影为活动，仍属于工具执行，不能打断连续操作组。 */
export function isTimelineOperation<T extends { type: string }>(
  item: T | undefined,
): item is Extract<T, { type: TimelineOperationType }> {
  return (
    item?.type === "command" ||
    item?.type === "file_change" ||
    item?.type === "tool" ||
    item?.type === "reasoning" ||
    (item?.type === "activity" &&
      "label" in item &&
      (item.label === "查看图片" || item.label === "等待"))
  );
}
