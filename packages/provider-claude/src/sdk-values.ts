import type { AgentItem } from "@codexly/protocol";

/** 结构化结果独立于过程正文；普通命令 result 只在没有助手正文时补齐，避免重复。 */
export function claudeResultMessage(
  message: Record<string, unknown>,
  turnId: string,
  items: Iterable<AgentItem>,
): Extract<AgentItem, { type: "message" }> | undefined {
  // 用 undefined 区分缺失字段，保留 false、0、空字符串及 null 等合法 JSON 值。
  const structured = message["structured_output"] !== undefined;
  if (
    !structured &&
    [...items].some((item) => item.type === "message" && item.role === "assistant")
  )
    return;
  const result = structured
    ? JSON.stringify(message["structured_output"])
    : text(message["result"]);
  if (!result) return;
  return {
    id: `${turnId}:result`,
    type: "message",
    role: "assistant",
    text: result,
    ...(structured ? { phase: "final_answer" as const } : {}),
  };
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function claudeResultError(
  message: Record<string, unknown>,
  success: boolean,
): string | undefined {
  if (success) return;
  const errors = Array.isArray(message["errors"])
    ? message["errors"].filter((error): error is string => typeof error === "string").join("\n")
    : "";
  return errors || text(message["result"]) || "Claude execution failed";
}

/** 中断后的 SDK result 也可能是 success；只将被中断的前台回合映射为 interrupted。 */
export function claudeTurnResult(
  message: Record<string, unknown>,
  interrupted: boolean,
): {
  success: boolean;
  status: "completed" | "failed" | "interrupted";
  error: string | undefined;
} {
  const success = !interrupted && message["subtype"] === "success" && message["is_error"] !== true;
  return {
    success,
    status: interrupted ? "interrupted" : success ? "completed" : "failed",
    error: interrupted ? undefined : claudeResultError(message, success),
  };
}

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
