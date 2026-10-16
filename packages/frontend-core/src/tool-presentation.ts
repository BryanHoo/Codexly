import type { AgentItem, AgentTurn } from "@codexly/protocol";

export type EmbeddedSubagentReference = Readonly<{ parentTaskId: string; itemId: string }>;
type ToolItem = Extract<AgentItem, { type: "tool" }>;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 只读取小型标量参数生成标题，避免序列化工具输出或扫描文件正文。 */
export function getToolTitle(item: ToolItem): string {
  const input = record(item.input);
  const scalar = (key: string) =>
    typeof input[key] === "string" ? input[key].slice(0, 240).replace(/\s+/gu, " ").trim() : "";
  const detail =
    scalar("description") ||
    (item.name === "Grep" ? [scalar("pattern"), scalar("path")].filter(Boolean).join(" · ") : "") ||
    scalar("file_path") ||
    scalar("notebook_path") ||
    scalar("command") ||
    scalar("pattern") ||
    scalar("query") ||
    scalar("url") ||
    scalar("path") ||
    scalar("skill");
  return (detail ? `${item.name} · ${detail}` : item.name).slice(0, 250);
}

export function getEmbeddedSubagentReference(
  item: ToolItem,
): EmbeddedSubagentReference | undefined {
  const output = record(item.output);
  return item.name === "agent/spawn" &&
    typeof output["parentTaskId"] === "string" &&
    Array.isArray(record(output["turn"])["items"])
    ? { parentTaskId: output["parentTaskId"], itemId: item.id }
    : undefined;
}

export function getEmbeddedSubagentTurn(value: unknown): AgentTurn | undefined {
  const item = value as AgentItem | undefined;
  if (item?.type !== "tool" || !getEmbeddedSubagentReference(item)) return undefined;
  const turn = record(record(item.output)["turn"]);
  return typeof turn["id"] === "string" && Array.isArray(turn["items"])
    ? (turn as AgentTurn)
    : undefined;
}
