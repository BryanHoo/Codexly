import { ClaudeSettingsPanel as SharedClaudeSettingsPanel, type ClaudeSettingsClient } from "@codexly/ui/core/claude-settings-panel";
import { engineChinese, engineEnglish } from "@codexly/frontend-core/engine-labels";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { SettingsGroup, SettingsField } from "./global-settings-fields.js";
import { nativeClient } from "../../projects/project-queries.js";

export function ClaudeSettingsPanel() {
  useTranslation("workbench");
  if (import.meta.env.VITE_MACOS_LEGACY === "true") return <p role="status">{getCurrentLanguage() === "zh-CN" ? engineChinese.unsupportedLegacy : engineEnglish.unsupportedLegacy}</p>;
  return <SharedClaudeSettingsPanel client={nativeClient satisfies ClaudeSettingsClient} labels={getCurrentLanguage() === "zh-CN" ? engineChinese : engineEnglish} Group={SettingsGroup} Field={SettingsField} />;
}
