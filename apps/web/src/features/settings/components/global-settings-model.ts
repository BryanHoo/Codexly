import {
  DEFAULT_COMMIT_MESSAGE_MODEL,
  type AgentGlobalSettings,
  type AgentModel,
  type AgentProjectDefaults,
} from "@codexly/protocol";

import { readThemePreference, type ThemePreference } from "../theme-preference.js";
import {
  applyApprovalMode as applySharedApprovalMode,
  deriveApprovalMode as deriveSharedApprovalMode,
  type ApprovalMode as SharedApprovalMode,
} from "../../../shared/approval-mode.js";

export type ApprovalMode = SharedApprovalMode;

export function resolveGlobalSettingsModel(
  models: readonly AgentModel[],
  modelId: string,
  requestedEffort: string,
): Pick<AgentProjectDefaults, "model" | "reasoningEffort"> {
  const model = models.find((item) => item.id === modelId);
  if (model === undefined) {
    return { model: modelId, reasoningEffort: requestedEffort };
  }
  const reasoningEffort = model.supportedReasoningEfforts.some(
    (effort) => effort.id === requestedEffort,
  )
    ? requestedEffort
    : model.defaultReasoningEffort;
  return { model: model.id, reasoningEffort };
}

export function deriveApprovalMode(settings: AgentGlobalSettings): ApprovalMode {
  return deriveSharedApprovalMode(settings);
}

export function applyApprovalMode(
  settings: AgentGlobalSettings,
  mode: ApprovalMode,
): AgentGlobalSettings {
  return applySharedApprovalMode(settings, mode);
}

export function createFallbackSettings(models: readonly AgentModel[]): AgentGlobalSettings {
  const model = models.find((item) => item.isDefault) ?? models[0];
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    commitMessageModel: DEFAULT_COMMIT_MESSAGE_MODEL,
    commitMessagePrompt: "",
    defaultOpenAppId: null,
    fastMode: false,
    followUpBehavior: "queue",
    model: model?.id ?? "",
    reasoningEffort: model?.defaultReasoningEffort ?? "",
    sandboxMode: "workspace-write",
  };
}

export function readInitialTheme(): ThemePreference {
  return typeof window === "undefined" ? "system" : readThemePreference(window.localStorage);
}
