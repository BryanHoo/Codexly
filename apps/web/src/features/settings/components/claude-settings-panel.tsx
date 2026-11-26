import type { ClaudeSettingsSectionId } from "@codexly/frontend-core/settings-navigation";
import { ClaudeSettingsPanel as SharedClaudeSettingsPanel } from "@codexly/ui/core/claude-settings-panel";
import {
  claudeSettingsChinese as engineChinese,
  claudeSettingsEnglish as engineEnglish,
} from "@codexly/frontend-core/claude-settings-labels";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { SettingsGroup, SettingsField, SettingsSelect } from "./global-settings-fields.js";
import type { SettingsClient } from "./global-settings-page-contracts.js";
import { lazy } from "react";

// 连接向导也使用此入口，默认配置控件仅在真正进入智能体设置时加载。
const AgentSettingsPanel = lazy(() =>
  import("./agent-settings-panel.js").then((module) => ({ default: module.AgentSettingsPanel })),
);

export function ClaudeSettingsPanel({
  client,
  section,
  onConnected,
  continueLabel,
}: Readonly<{
  client: SettingsClient;
  section: ClaudeSettingsSectionId;
  onConnected?: (() => void) | undefined;
  continueLabel?: string | undefined;
}>) {
  const { t } = useTranslation("settings");
  const labels = getCurrentLanguage() === "zh-CN" ? engineChinese : engineEnglish;
  if (section === "claude-agent") return <AgentSettingsPanel client={client} engine="claude" />;
  return (
    <SharedClaudeSettingsPanel
      onConnected={onConnected}
      continueLabel={continueLabel}
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
