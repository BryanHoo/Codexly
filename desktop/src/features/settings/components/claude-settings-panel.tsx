import type { ClaudeSettingsSectionId } from "@codexly/frontend-core/settings-navigation";
import { ClaudeSettingsPanel as SharedClaudeSettingsPanel, type ClaudeSettingsClient } from "@codexly/ui/core/claude-settings-panel";
import { engineChinese, engineEnglish } from "@codexly/frontend-core/engine-labels";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { SettingsGroup, SettingsField, SettingsSelect } from "./global-settings-fields.js";
import { nativeClient } from "../../projects/project-queries.js";

export function ClaudeSettingsPanel({ section }: Readonly<{ section: ClaudeSettingsSectionId }>) {
  const { t } = useTranslation("settings");
  const labels = getCurrentLanguage() === "zh-CN" ? engineChinese : engineEnglish;
  if (import.meta.env.VITE_MACOS_LEGACY === "true") return <p role="status">{getCurrentLanguage() === "zh-CN" ? engineChinese.unsupportedLegacy : engineEnglish.unsupportedLegacy}</p>;
  return <SharedClaudeSettingsPanel client={nativeClient satisfies ClaudeSettingsClient} section={section} title={t(`sections.${section}`)} labels={labels} Group={SettingsGroup} Field={SettingsField} Select={SettingsSelect} />;
}
