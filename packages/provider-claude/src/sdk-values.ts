export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** SDK 本地命令正文属于助手展示消息；按类型转换，不能根据命令名猜测输出形态。 */
export function displayClaudeMessage(value: unknown): Record<string, unknown> {
  const message = record(value);
  if (message["type"] !== "system" || message["subtype"] !== "local_command_output") return message;
  const uuid = text(message["uuid"]),
    content = text(message["content"]);
  if (!uuid || !content) return message;
  // 保留父代理关联字段，复用正文的有界渲染、UUID 去重、完成事件与历史持久化。
  return {
    ...message,
    type: "assistant",
    message: { id: `local-command:${uuid}`, content: [{ type: "text", text: content }] },
  };
}
export const resultText = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map((part) => text(record(part)["text"]))
        .filter(Boolean)
        .join("\n")
    : text(value);
