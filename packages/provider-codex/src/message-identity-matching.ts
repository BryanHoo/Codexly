import type { AgentItem } from "@codexly/protocol";

export type IdentityMessage = Extract<AgentItem, { type: "message" }>;

export function matchesMessageIdentity(
  current: IdentityMessage,
  incoming: IdentityMessage,
): boolean {
  if (current.role !== incoming.role) return false;
  if (
    current.phase !== undefined &&
    incoming.phase !== undefined &&
    current.phase !== incoming.phase
  )
    return false;
  if (current.text.length > 0 && incoming.text.length > 0) {
    return current.text.startsWith(incoming.text) || incoming.text.startsWith(current.text);
  }
  if (current.role !== "user" || current.text.length > 0 || incoming.text.length > 0) return false;
  const attachments = current.attachments ?? [];
  const other = incoming.attachments ?? [];
  // 原生历史与上传资源的授权 ID 不同，只在图片元数据候选唯一时建立别名。
  return (
    attachments.length > 0 &&
    attachments.length === other.length &&
    attachments.every(
      (item, index) =>
        item.kind === "image" &&
        other[index]?.kind === "image" &&
        item.mediaType === other[index].mediaType &&
        item.size === other[index].size,
    )
  );
}
