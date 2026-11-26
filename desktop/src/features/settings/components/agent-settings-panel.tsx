import {
  AcpDefaultSettings,
  acpDefaultSettingsLabels,
  type AcpDefaultsClient,
} from "@codexly/ui/core/acp-default-settings";
import type { AgentEngine } from "@codexly/protocol";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { SettingsField, SettingsSelect } from "./global-settings-fields.js";
import { nativeClient } from "../../projects/project-query-contracts.js";

export function AgentSettingsPanel({
  client = nativeClient,
  engine = "codex",
}: Readonly<{ client?: AcpDefaultsClient; engine?: AgentEngine }>) {
  const { t } = useTranslation("settings");
  return (
    <section id={engine === "codex" ? "settings-panel-agent" : "settings-panel-claude-agent"}>
      <h1 className="mb-6 text-xl font-semibold">
        {t(engine === "codex" ? "sections.agent" : "sections.claude-agent")}
      </h1>
      <AcpDefaultSettings
        client={client}
        engine={engine}
        Field={SettingsField}
        Select={SettingsSelect}
        labels={acpDefaultSettingsLabels[getCurrentLanguage() === "zh-CN" ? "zh-CN" : "en"]}
      />
    </section>
  );
}
