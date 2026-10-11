export type TaskTimelineNavigationItem = Readonly<{
  anchorId: string;
  preview: string;
  turnIndex: number;
}>;

export type TimelineNavigationState<Item> = Readonly<{
  itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
  itemStoresByKey: ReadonlyMap<string, Readonly<{ peek: () => Item }>>;
  turnIds: readonly string[];
}>;

export function getTaskTimelineNavigationItems<Item>(
  state: TimelineNavigationState<Item>,
  getPreview: (item: Item) => string | null,
): TaskTimelineNavigationItem[] {
  const items: TaskTimelineNavigationItem[] = [];
  // 直接读取按回合排列的键索引，避免恢复完整快照；预览文案由平台注入。
  state.turnIds.forEach((turnId, turnIndex) => {
    for (const itemKey of state.itemKeysByTurnId[turnId] ?? []) {
      const item = state.itemStoresByKey.get(itemKey)?.peek();
      if (item === undefined) continue;
      const preview = getPreview(item);
      if (preview !== null) items.push({ anchorId: itemKey, preview, turnIndex });
    }
  });
  return items;
}

export function getUserMessageNavigationPreview(
  item: Readonly<{
    attachments?: readonly Readonly<{ name: string }>[];
    skills?: readonly Readonly<{ name: string }>[];
    text: string;
  }>,
): string {
  // 保留用户可见的 Skill、正文与附件顺序，空段落不产生额外分隔符。
  return [
    ...(item.skills ?? []).map((skill) => `$${skill.name}`),
    item.text,
    ...(item.attachments ?? []).map((attachment) => attachment.name),
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}
