import type { AgentEngine, AgentModel, AgentTaskSettings, ClaudeSettings } from "@codexly/protocol";

export function resolveComposerEngine(
  taskId: string | undefined,
  task: Readonly<{ engine?: AgentEngine }> | undefined,
  draftEngine: AgentEngine,
  configured?: Readonly<Record<AgentEngine, boolean>>,
): AgentEngine {
  // 历史任务缺少字段表示旧版 Codex；不能让当前草稿选择污染历史归属。
  if (taskId !== undefined) return task?.engine ?? "codex";
  // 单引擎配置优先于草稿记忆，避免卸载配置后仍将新消息发往失效的引擎。
  if (configured !== undefined && !(configured.codex && configured.claude)) {
    return configured.claude ? "claude" : "codex";
  }
  return draftEngine;
}

export function resolveClaudeComposerSettings(
  settings: AgentTaskSettings,
  models: readonly AgentModel[],
  defaults?: ClaudeSettings,
): AgentTaskSettings {
  if (settings.engineOptions?.engine === "claude") return settings;
  const model = models.find((model) => model.isDefault) ?? models[0];
  return {
    model:
      defaults?.model && defaults.model !== "default" ? defaults.model : (model?.id ?? "default"),
    reasoningEffort: defaults?.reasoningEffort ?? "",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
    engineOptions: { engine: "claude", permissionMode: defaults?.permissionMode ?? "default" },
  };
}
