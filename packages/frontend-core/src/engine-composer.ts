import type { AgentEngine, AgentModel, AgentTaskSettings, ClaudeSettings } from "@codexly/protocol";

export function resolveComposerEngine(
  taskId: string | undefined,
  task: Readonly<{ engine?: AgentEngine }> | undefined,
  draftEngine: AgentEngine,
  configured?: Readonly<Record<AgentEngine, boolean>>,
  preserveDraftEngine = false,
): AgentEngine {
  // 历史任务缺少字段表示旧版 Codex；不能让当前草稿选择污染历史归属。
  if (taskId !== undefined) return task?.engine ?? "codex";
  // 已保存的计划只恢复自己的引擎；配置暂不可用也不能静默改写执行目标。
  if (preserveDraftEngine) return draftEngine;
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

/** 切回 Codex 时使用其模型目录，不能携带 Claude 的模型和权限封套。 */
export function resolveCodexComposerSettings(
  settings: AgentTaskSettings,
  models: readonly AgentModel[],
): AgentTaskSettings {
  if (settings.engineOptions === undefined) return settings;
  const model = models.find((item) => item.isDefault) ?? models[0];
  return {
    model: model?.id ?? "",
    reasoningEffort: model?.defaultReasoningEffort ?? "",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
  };
}
