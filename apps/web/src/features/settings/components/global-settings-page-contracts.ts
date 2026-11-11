import type { AcpAuthClient } from "@codexly/ui/core/acp-auth-settings";
import type {
  AccessMode,
  AgentGlobalSettings,
  AgentModel,
  AppInfoResponse,
  AppUpdateProgress,
  ProjectOpenApp,
} from "@codexly/protocol";

import type { SettingsSectionId } from "./global-settings-fields.js";

export type GlobalSettingsPageProps = Readonly<{
  agentRuntime?: "pending" | "legacy" | "acp";
  accessMode?: AccessMode;
  appInfo?: AppInfoResponse;
  appInfoError?: Error | null;
  appUpdateProgress?: AppUpdateProgress;
  apps: readonly ProjectOpenApp[];
  error: Error | null;
  fastModeAvailable?: boolean;
  initialSection?: SettingsSectionId;
  isAppInfoPending?: boolean;
  isAppUpdatePending?: boolean;
  isPending: boolean;
  models: readonly AgentModel[];
  onClose: () => void;
  onLogoutAccess?: () => Promise<void>;
  onRetry: () => unknown;
  onRetryAppInfo?: () => unknown;
  onSave: (settings: AgentGlobalSettings) => Promise<void>;
  onUpdate?: (version: string) => Promise<void>;
  settings?: AgentGlobalSettings;
}>;
import type { CodexlyClient } from "@codexly/client";
export type SettingsClient = Pick<
  CodexlyClient,
  | "getDiagnostics"
  | "getAcpDefaults"
  | "setAcpDefaultConfig"
  | "saveDiagnostics"
  | "diagnosticsDownloadUrl"
  | "getEngineProfile"
  | "configureEngine"
  | "disconnectEngine"
  | "getClaudeSettings"
  | "updateClaudeSettings"
  | "getGlobalInstructions"
  | "saveGlobalInstructions"
  | "getMemorySettings"
  | "updateMemorySettings"
  | "resetMemories"
  | "compressHistory"
  | "getAgentPreferences"
  | "updateAgentPreferences"
> &
  Partial<AcpAuthClient>;
