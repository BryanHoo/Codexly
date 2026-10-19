import type { AgentItem } from "@codexly/protocol";

/** 读取叠加只修改本次响应，不写盘。游标只计算磁盘索引，Token 和尚未落盘的新记录不会改变旧页偏移。 */
export function overlayClaudeItems(
  page: { items: AgentItem[]; before: number | null },
  live: readonly AgentItem[] | undefined,
  budget: number,
  limit: number,
): { items: AgentItem[]; before: number | null } {
  // 当前预算连一条磁盘记录也容纳不下时，交给分页器续页，不能把旧 live 记录误当成未保存的新记录。
  if (!live || (!page.items.length && page.before !== null)) return page;
  const byId = new Map(live.map((item) => [item.id, item]));
  const persisted = new Set(page.items.map((item) => item.id));
  const last = page.items.at(-1)?.id;
  const position = last === undefined ? -1 : live.findIndex((item) => item.id === last);
  // 展示缓存保留最近尾部：尾部重叠后才追加内存中的新记录，不重新插入较早的已索引记录。
  const items = [
    ...page.items.map((item) => byId.get(item.id) ?? item),
    ...(last !== undefined && position < 0 ? [] : live.slice(position + 1)).filter(
      (item) => !persisted.has(item.id),
    ),
  ];
  let bytes = items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)) + 1, 0);
  let removed = 0,
    start = 0;
  while ((items.length - start > limit || bytes > budget) && start < items.length) {
    const item = items[start++];
    if (!item) break;
    bytes -= Buffer.byteLength(JSON.stringify(item)) + 1;
    if (persisted.has(item.id)) removed++;
    else throw new Error("Claude live history exceeds page budget");
  }
  const before = (page.before ?? 0) + removed * 64;
  return { items: items.slice(start), before: before || null };
}
