import type { AgentEngine, TaskSearchQuery } from "@codexly/protocol";

/** 使用依赖向导的启用集合；固定顺序，避免选择顺序生成不同的缓存键或续页身份。 */
export function searchEngineFilter(
  engines: readonly AgentEngine[] | undefined,
): TaskSearchQuery["engines"] {
  if (!engines) return undefined;
  if (engines.includes("codex") && engines.includes("claude")) return "codex,claude";
  return engines.includes("claude") ? "claude" : "codex";
}
