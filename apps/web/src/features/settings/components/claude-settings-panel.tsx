import type { ClaudeSettingsSectionId } from "@codexly/frontend-core/settings-navigation";
import { ClaudeSettingsPanel as SharedClaudeSettingsPanel } from "@codexly/ui/core/claude-settings-panel";
import { engineChinese, engineEnglish } from "@codexly/frontend-core/engine-labels";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { SettingsGroup, SettingsField, SettingsSelect } from "./global-settings-fields.js";
import type { SettingsClient } from "./global-settings-page-contracts.js";

export function ClaudeSettingsPanel({
  client,
  section,
}: Readonly<{ client: SettingsClient; section: ClaudeSettingsSectionId }>) {
  const { t } = useTranslation("settings");
  const labels = getCurrentLanguage() === "zh-CN" ? engineChinese : engineEnglish;
  return (
    <SharedClaudeSettingsPanel
      client={client}
      section={section}
      title={t(`sections.${section}`)}
      labels={labels}
      Group={SettingsGroup}
      Field={SettingsField}
      Select={SettingsSelect}
    />
  );
}
