import type { AgentSandboxMode, AgentTaskSettings } from "@code-agent/protocol";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputSelect } from "../../../shared/components/agent/prompt-input.js";
import { applyApprovalMode, deriveApprovalMode, type ApprovalMode } from "../composer-state.js";

type ComposerApprovalControlsProps = Readonly<{
  disabled: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
  ) => Promise<void> | void;
  sandboxModeSelectable: boolean;
  settings: AgentTaskSettings;
}>;

export function ComposerApprovalControls({
  disabled,
  onSettingsChange,
  sandboxModeSelectable,
  settings,
}: ComposerApprovalControlsProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  return (
    <>
      <PromptInputSelect
        aria-label={t("composer.approvalMode")}
        className="max-workbench:px-0.5"
        disabled={disabled}
        onChange={(event) => {
          void onSettingsChange(
            applyApprovalMode(settings, event.currentTarget.value as ApprovalMode),
            "approvalPolicy",
          );
        }}
        value={deriveApprovalMode(settings)}
      >
        <option value="on-request">{t("settings:approval.onRequest")}</option>
        <option value="auto-review">{t("settings:approval.autoReview")}</option>
        <option value="never">{t("settings:approval.never")}</option>
      </PromptInputSelect>
      {sandboxModeSelectable ? (
        <>
          <PromptInputSelect
            aria-label={t("composer.sandboxMode")}
            className="max-workbench:px-0.5"
            disabled={disabled}
            onChange={(event) => {
              void onSettingsChange(
                {
                  ...settings,
                  sandboxMode: event.currentTarget.value as AgentSandboxMode,
                },
                "sandboxMode",
              );
            }}
            value={settings.sandboxMode}
          >
            <option value="read-only">{t("settings:sandbox.readOnly")}</option>
            <option value="workspace-write">{t("settings:sandbox.workspaceWrite")}</option>
            <option value="danger-full-access">{t("settings:sandbox.dangerFullAccess")}</option>
          </PromptInputSelect>
        </>
      ) : null}
    </>
  );
}
