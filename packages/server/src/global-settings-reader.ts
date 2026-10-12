import type { AgentRuntimeDefaultSettings } from "@codexly/core";
import {
  DEFAULT_COMMIT_MESSAGE_MODEL,
  type AgentGlobalSettings,
  type AgentModel,
} from "@codexly/protocol";
import { resolveProjectDefaults } from "./server-runtime.js";

/** 合并 Codex 默认值与应用偏好；上下文窗口始终由 Codex 管理。 */
export function resolveGlobalSettings(
  catalog: readonly AgentModel[],
  stored: AgentGlobalSettings | undefined,
  runtimeDefaults: AgentRuntimeDefaultSettings,
): AgentGlobalSettings {
  const requestedDefaults = { ...stored, ...runtimeDefaults };
  const effectiveModel = resolveProjectDefaults(
    catalog,
    requestedDefaults,
    requestedDefaults.sandboxMode ?? "workspace-write",
  );
  const effectiveCommitModel = resolveProjectDefaults(
    catalog,
    {
      model: stored?.commitMessageModel ?? DEFAULT_COMMIT_MESSAGE_MODEL,
      sandboxMode: "read-only",
    },
    "read-only",
  );
  const approvalPolicy = requestedDefaults.approvalPolicy ?? "on-request";
  const approvalsReviewer = requestedDefaults.approvalsReviewer ?? "user";
  // 全局记录缺失时只返回运行时默认值；读取不能隐式创建用户配置。
  return {
    approvalPolicy,
    approvalsReviewer,
    commitMessageModel: effectiveCommitModel.model,
    commitMessagePrompt: stored?.commitMessagePrompt ?? "",
    // 窗口只从 Codex 读取；不继承 SQLite 快照，也不硬编码特定模型容量。
    modelContextWindow: runtimeDefaults.modelContextWindow ?? null,
    defaultOpenAppId: stored?.defaultOpenAppId ?? null,
    fastMode: runtimeDefaults.fastMode ?? stored?.fastMode ?? false,
    followUpBehavior: stored?.followUpBehavior ?? "queue",
    pet: stored?.pet ?? { enabled: false, selectedPetId: null },
    ...effectiveModel,
  };
}
