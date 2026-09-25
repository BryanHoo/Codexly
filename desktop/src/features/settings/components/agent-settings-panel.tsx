import type { AgentGlobalSettings, AgentModel } from "@/protocol/index.js";

import { useTranslation } from "../../../i18n/i18n.js";
import "../../../i18n/settings-general.js";
import { FastModeSettingsField, ModelSelect, ReasoningSelect, SettingsField, SettingsGroup, SettingsSelect } from "./global-settings-fields.js";
import { applyApprovalMode, deriveApprovalMode, resolveGlobalSettingsModel, type ApprovalMode } from "./global-settings-model.js";

const runtimeFields = [
  { key: "webSearch", options: ["disabled", "cached", "live"] },
  { key: "modelVerbosity", options: ["", "low", "medium", "high"] },
] as const;

export function AgentSettingsPanel({ settings, models, fastModeAvailable, onChange }: Readonly<{
  settings: AgentGlobalSettings;
  models: readonly AgentModel[];
  fastModeAvailable: boolean;
  onChange: (settings: AgentGlobalSettings) => void;
}>) {
  const { t } = useTranslation("settings");
  const selectedModel = models.find((model) => model.id === settings.model);
  return (
    <section id="settings-panel-agent">
      <h1 className="mb-6 text-xl font-semibold">{t("sections.agent")}</h1>
      <div className="space-y-6">
        <SettingsGroup title={t("agent.defaults")}>
          <SettingsField label={t("fields.approvalPolicy")} description={t("general.approvalDescription")}>
            <SettingsSelect aria-label={t("fields.approvalPolicy")} value={deriveApprovalMode(settings)} onChange={(event) => onChange(applyApprovalMode(settings, event.currentTarget.value as ApprovalMode))}>
              <option value="on-request">{t("approval.onRequest")}</option>
              <option value="auto-review">{t("approval.autoReview")}</option>
              <option value="never">{t("approval.never")}</option>
            </SettingsSelect>
          </SettingsField>
          <SettingsField label={t("fields.sandbox")} description={t("general.sandboxDescription")}>
            <SettingsSelect aria-label={t("fields.sandbox")} value={settings.sandboxMode} onChange={(event) => onChange({ ...settings, sandboxMode: event.currentTarget.value as AgentGlobalSettings["sandboxMode"] })}>
              <option value="read-only">{t("sandbox.readOnly")}</option>
              <option value="workspace-write">{t("sandbox.workspaceWrite")}</option>
              <option value="danger-full-access">{t("sandbox.dangerFullAccess")}</option>
            </SettingsSelect>
          </SettingsField>
          {runtimeFields.map(({ key, options }) => (
            <SettingsField key={key} label={t(`agent.${key}.label`)} description={t(`agent.${key}.description`)}>
              <SettingsSelect aria-label={t(`agent.${key}.label`)} value={settings[key] ?? ""} onChange={(event) => {
                // 空选项只用于输出详细程度，null 表示不覆盖模型的默认值。
                onChange({ ...settings, [key]: event.currentTarget.value || null });
              }}>
                {options.map((value) => <option key={value} value={value}>{t(`agent.${key}.${value || "default"}`)}</option>)}
              </SettingsSelect>
            </SettingsField>
          ))}
        </SettingsGroup>
        <SettingsGroup title={t("agent.model")}>
          {fastModeAvailable ? <FastModeSettingsField enabled={settings.fastMode} onChange={(fastMode) => onChange({ ...settings, fastMode })} /> : null}
          <SettingsField label={t("fields.model")}>
            <ModelSelect ariaLabel={t("fields.model")} models={models} value={settings.model} onChange={(modelId) => onChange({ ...settings, ...resolveGlobalSettingsModel(models, modelId, settings.reasoningEffort) })} />
          </SettingsField>
          <SettingsField label={t("fields.reasoningEffort")}>
            <ReasoningSelect ariaLabel={t("fields.reasoningEffort")} disabled={selectedModel === undefined} model={selectedModel} value={settings.reasoningEffort} onChange={(reasoningEffort) => onChange({ ...settings, reasoningEffort })} />
          </SettingsField>
        </SettingsGroup>
      </div>
    </section>
  );
}
