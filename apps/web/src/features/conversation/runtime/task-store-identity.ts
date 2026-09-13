import type { AgentItem } from "@codexly/protocol";
import { createTaskItemKey, type TaskStoreState } from "./task-store-core.js";

export function resolveMessageAliases(
  current: readonly AgentItem[],
  incoming: readonly AgentItem[],
  turnId: string,
): AgentItem[] {
  const replacements = new Map<string, AgentItem>();
  for (const item of incoming) {
    if (item.type !== "message") continue;
    for (const alias of item.identityAliases ?? []) replacements.set(alias, item);
  }
  const firstUser = incoming.find((item) => item.type === "message" && item.role === "user");
  // 提交占位符属于本地渲染状态；首次权威用户实体出现后直接接管，不比较正文或图片。
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
  state: TaskStoreState,
  turnId: string,
  item: AgentItem,
): readonly string[] {
  const keys = state.itemKeysByTurnId[turnId] ?? [];
  if (item.type !== "message" || !item.identityAliases?.length) return keys;
  const canonicalKey = createTaskItemKey(turnId, item.id);
  const aliases = new Set(
    item.identityAliases.filter((id) => id !== item.id).map((id) => createTaskItemKey(turnId, id)),
  );
  for (const key of aliases) state.itemStoresByKey.delete(key);
  // 规范实体占用最早别名的位置，避免消息在终态确认时跳到列表末尾。
  return [...new Set(keys.map((key) => (aliases.has(key) ? canonicalKey : key)))];
}
