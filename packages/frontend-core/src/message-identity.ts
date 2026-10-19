import { createTaskItemKey } from "./task-state.js";

// 使用两端共有的最小结构，桌面扩展消息字段仍由原生协议保留。
interface IdentityItem {
  id: string;
  type: string;
  role?: string;
  identityAliases?: readonly string[];
}

export function resolveMessageAliases<Item extends IdentityItem>(
  current: readonly Item[],
  incoming: readonly Item[],
  turnId: string,
): Item[] {
  const replacements = new Map<string, Item>();
  for (const item of incoming) {
    if (item.type !== "message") continue;
    for (const alias of item.identityAliases ?? []) replacements.set(alias, item);
  }
  const firstUser = incoming.find((item) => item.type === "message" && item.role === "user");
  // 提交占位符是本地渲染状态，首个权威用户实体可直接接管；绝不比较正文或附件。
  if (firstUser !== undefined) replacements.set(`submitted-user-${turnId}`, firstUser);
  const seen = new Set<string>();
  return current.flatMap((item) => {
    const resolved = replacements.get(item.id) ?? item;
    if (seen.has(resolved.id)) return [];
    seen.add(resolved.id);
    return [resolved];
  });
}

export function applyMessageAliases(
  state: {
    itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
    itemStoresByKey: { delete(key: string): boolean };
  },
  turnId: string,
  item: IdentityItem,
): readonly string[] {
  const keys = state.itemKeysByTurnId[turnId] ?? [];
  if (item.type !== "message" || !item.identityAliases?.length) return keys;
  const canonicalKey = createTaskItemKey(turnId, item.id);
  const aliases = new Set(
    item.identityAliases.filter((id) => id !== item.id).map((id) => createTaskItemKey(turnId, id)),
  );
  for (const key of aliases) state.itemStoresByKey.delete(key);
  // 规范实体占用最早别名的位置，避免完成确认时消息跳到列表末尾。
  return [...new Set(keys.map((key) => (aliases.has(key) ? canonicalKey : key)))];
}

export function retainSnapshotTurnItems<Item extends IdentityItem>(
  current: readonly Item[],
  incoming: readonly Item[],
  turnId: string,
): Item[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const retained = resolveMessageAliases(current, incoming, turnId).map((item) => {
    const authoritative = incomingById.get(item.id);
    incomingById.delete(item.id);
    return authoritative ?? item;
  });
  // 同一运行时的摘要可能尚未持久化实时操作，仅使用 ID 和明确别名补齐。
  return [...retained, ...incomingById.values()];
}
