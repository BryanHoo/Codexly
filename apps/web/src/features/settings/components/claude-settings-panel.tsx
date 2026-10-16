import {
  ClaudeSettingsPanel as SharedClaudeSettingsPanel,
  type ClaudeSettingsClient,
} from "@codexly/ui/core/claude-settings-panel";
import { engineChinese, engineEnglish } from "@codexly/frontend-core/engine-labels";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { SettingsGroup, SettingsField } from "./global-settings-fields.js";
import type { SettingsClient } from "./global-settings-page-contracts.js";

export function ClaudeSettingsPanel({ client }: Readonly<{ client: SettingsClient }>) {
  useTranslation("workbench");
  return (
    <SharedClaudeSettingsPanel
      client={client as SettingsClient & ClaudeSettingsClient}
      labels={getCurrentLanguage() === "zh-CN" ? engineChinese : engineEnglish}
      Group={SettingsGroup}
      Field={SettingsField}
    />
  );
}
