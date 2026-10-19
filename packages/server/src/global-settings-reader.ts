import type { AgentRuntimeDefaultSettings } from "@codexly/core";
import {
  DEFAULT_GENERATION_MODEL,
  type AgentGlobalSettings,
  type AgentModel,
  type AgentEngine,
} from "@codexly/protocol";
import { resolveProjectDefaults } from "./server-runtime.js";

/** 合并 Codex 默认值与应用偏好；上下文窗口始终由 Codex 管理。 */
export function resolveGlobalSettings(
  catalog: readonly AgentModel[],
  stored: AgentGlobalSettings | undefined,
  runtimeDefaults: AgentRuntimeDefaultSettings,
  engines: readonly AgentEngine[] = ["codex", "claude"],
): AgentGlobalSettings {
  const requestedDefaults = { ...stored, ...runtimeDefaults };
  const effectiveModel = resolveProjectDefaults(
    catalog,
    requestedDefaults,
    requestedDefaults.sandboxMode ?? "workspace-write",
  );
  // 辅助模型不能被当前聊天的模型目录替换，两个 Agent 的模型目录彼此独立。
  const defaultAgent = engines.includes(stored?.defaultAgent ?? "codex")
    ? (stored?.defaultAgent ?? "codex")
    : (engines[0] ?? "codex");
  const defaultModel =
    stored?.defaultModel && (stored.defaultAgent ?? "codex") === defaultAgent
      ? stored.defaultModel
      : defaultAgent === "claude"
        ? "haiku"
        : DEFAULT_GENERATION_MODEL;
  const approvalPolicy = requestedDefaults.approvalPolicy ?? "on-request";
  const approvalsReviewer = requestedDefaults.approvalsReviewer ?? "user";
  // 全局记录缺失时只返回运行时默认值；读取不能隐式创建用户配置。
  return {
    approvalPolicy,
    approvalsReviewer,
    defaultAgent,
    defaultModel,
    commitMessagePrompt: stored?.commitMessagePrompt ?? "",
    ...(stored?.taskTitlePrompt ? { taskTitlePrompt: stored.taskTitlePrompt } : {}),
    // 窗口只从 Codex 读取；不继承 SQLite 快照，也不硬编码特定模型容量。
    modelContextWindow: runtimeDefaults.modelContextWindow ?? null,
    defaultOpenAppId: stored?.defaultOpenAppId ?? null,
    fastMode: runtimeDefaults.fastMode ?? stored?.fastMode ?? false,
    followUpBehavior: stored?.followUpBehavior ?? "queue",
    pet: stored?.pet ?? { enabled: false, selectedPetId: null },
    ...effectiveModel,
  };
}
