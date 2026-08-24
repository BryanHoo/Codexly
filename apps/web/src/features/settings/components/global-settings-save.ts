import type { AgentGlobalSettings } from "@code-agent/protocol";

import type { SupportedLanguage } from "../../../i18n/language-preference.js";
import type { ThemePreference } from "../theme-preference.js";

export type BrowserSettingsDraft = Readonly<{
  language: SupportedLanguage;
  notificationsEnabled: boolean;
  theme: ThemePreference;
}>;

type SaveGlobalSettingsDependencies = Readonly<{
  applyBrowserSettings: (settings: BrowserSettingsDraft) => Promise<void> | void;
  saveGlobalSettings: (settings: AgentGlobalSettings) => Promise<void>;
}>;

export async function saveGlobalSettingsDraft(
  globalSettings: AgentGlobalSettings,
  browserSettings: BrowserSettingsDraft,
  dependencies: SaveGlobalSettingsDependencies,
): Promise<void> {
  // 浏览器偏好只能在服务端设置保存成功后提交，保证取消或失败不会产生副作用。
  await dependencies.saveGlobalSettings(globalSettings);
  await dependencies.applyBrowserSettings(browserSettings);
}
