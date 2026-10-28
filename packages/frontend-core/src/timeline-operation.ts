type TimelineOperationType = "command" | "file_change" | "tool" | "reasoning" | "activity";

/** 两端共用操作分类：查看图片虽投影为活动，仍属于工具执行，不能打断连续操作组。 */
export function isTimelineOperation<T extends { type: string }>(
  item: T | undefined,
): item is Extract<T, { type: TimelineOperationType }> {
  return (
    item?.type === "command" ||
    item?.type === "file_change" ||
    item?.type === "tool" ||
    item?.type === "reasoning" ||
    (item?.type === "activity" && "label" in item && item.label === "查看图片")
  );
}
