import type {
  AccessMode,
  AgentGlobalSettings,
  AgentModel,
  AppInfoResponse,
  AppUpdateProgress,
  ProjectOpenApp,
} from "@codexly/protocol";

import type { SettingsSectionId } from "./global-settings-fields.js";

export type GlobalSettingsDialogProps = Readonly<{
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
