import { changeAppLanguage } from "../../../i18n/i18n.js";
import type { SupportedLanguage } from "../../../i18n/language-preference.js";
import { setNotificationPreference } from "../notification-preference.js";
import { setThemePreference, type ThemePreference } from "../theme-preference.js";

export type BrowserSettingsChanges = Readonly<{
  language?: SupportedLanguage;
  notificationsEnabled?: boolean;
  theme?: ThemePreference;
}>;

export async function applyBrowserSettingsChanges(
  changes: BrowserSettingsChanges,
): Promise<void> {
  if (changes.theme !== undefined && typeof window !== "undefined") {
    setThemePreference(changes.theme);
  }
  if (changes.notificationsEnabled !== undefined) {
    setNotificationPreference(changes.notificationsEnabled);
  }
  if (changes.language !== undefined) {
    await changeAppLanguage(changes.language);
  }
}
