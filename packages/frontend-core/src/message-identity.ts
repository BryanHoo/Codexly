import { createTaskItemKey } from "./task-state.js";

// 使用两端共有的最小结构，桌面扩展消息字段仍由原生协议保留。
interface IdentityItem {
  id: string;
  type: string;
  role?: string;
  identityAliases?: readonly string[];
}

/** 只读取条目元数据查找已知身份，不展开历史正文；完整消息事件才调用此路径。 */
export function findMessageAliasKeys<Item extends IdentityItem>(
  state: {
    itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
    itemStoresByKey: { get(key: string): { peek(): Item } | undefined };
  },
  turnId: string,
  incoming: Item,
): string[] {
  if (incoming.type !== "message") return [];
  const identities = [incoming.id, ...(incoming.identityAliases ?? [])];
  return (state.itemKeysByTurnId[turnId] ?? []).filter((key) => {
    const current = state.itemStoresByKey.get(key)?.peek();
    return (
      current?.type === "message" &&
      identities.some((id) => current.id === id || current.identityAliases?.includes(id))
    );
  });
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

/** 快照及终态批次共同继承已确认的双向身份关系。 */
export function inheritMessageAliases<Item extends IdentityItem>(
  current: readonly Item[],
  incoming: readonly Item[],
): Item[] {
  // 身份关联属于整个会话，后续摘要省略别名不能撤销它。先索引已有关系，
  // 让原生历史与持久回答交替返回各自 ID 时仍能原位接管，不依赖正文猜测。
  const currentByIdentity = new Map<string, Item>();
  for (const item of current) {
    if (item.type !== "message") continue;
    currentByIdentity.set(item.id, item);
    for (const alias of item.identityAliases ?? []) currentByIdentity.set(alias, item);
  }
  return incoming.map((item) => {
    if (item.type !== "message") return item;
    const identities = [item.id, ...(item.identityAliases ?? [])];
    const aliases = new Set(item.identityAliases);
    for (const id of identities) {
      const previous = currentByIdentity.get(id);
      if (previous === undefined) continue;
      aliases.add(previous.id);
      for (const alias of previous.identityAliases ?? []) aliases.add(alias);
    }
    aliases.delete(item.id);
    return aliases.size === 0 ? item : { ...item, identityAliases: [...aliases] };
  });
}

export function retainSnapshotTurnItems<Item extends IdentityItem>(
  current: readonly Item[],
  incoming: readonly Item[],
  turnId: string,
): Item[] {
  const normalized = inheritMessageAliases(current, incoming);
  const incomingById = new Map(normalized.map((item) => [item.id, item]));
  const retained = resolveMessageAliases(current, normalized, turnId).map((item) => {
    const authoritative = incomingById.get(item.id);
    incomingById.delete(item.id);
    return authoritative ?? item;
  });
  // 同一运行时的摘要可能尚未持久化实时操作，仅使用 ID 和明确别名补齐。
  return [...retained, ...incomingById.values()];
}
