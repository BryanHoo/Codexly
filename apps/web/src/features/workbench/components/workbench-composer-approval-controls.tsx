import { ClaudePermissionSelector } from "@codexly/ui/core/agent-engine-controls";
import type { AgentSandboxMode, AgentTaskSettings } from "@codexly/protocol";

import { useTranslation } from "../../../i18n/i18n.js";
import { CompactSelector } from "@codexly/ui/core/compact-selector";
import { applyApprovalMode, deriveApprovalMode, type ApprovalMode } from "../composer-state.js";

type ComposerApprovalControlsProps = Readonly<{
  control?: "approval" | "sandbox";
  disabled: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
  ) => Promise<void> | void;
  sandboxModeSelectable: boolean;
  settings: AgentTaskSettings;
}>;

export function ComposerApprovalControls({
  control,
  disabled,
  onSettingsChange,
  sandboxModeSelectable,
  settings,
}: ComposerApprovalControlsProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  if (settings.engineOptions?.engine === "claude")
    return control === "sandbox" ? null : (
      <ClaudePermissionSelector
        label={t("engine.permissions")}
        disabled={disabled}
        value={settings.engineOptions.permissionMode}
        labels={{
          default: t("engine.permissionDefault"),
          auto: t("engine.permissionAuto"),
          acceptEdits: t("engine.permissionEdits"),
          plan: t("engine.permissionPlan"),
          dontAsk: t("engine.permissionDeny"),
          bypassPermissions: t("engine.permissionBypass"),
        }}
        onChange={(permissionMode) => {
          return onSettingsChange(
            { ...settings, engineOptions: { engine: "claude", permissionMode } },
            "engineOptions",
          );
        }}
      />
    );
  return (
    <>
      {control !== "sandbox" ? (
        <CompactSelector<ApprovalMode>
          label={t("composer.approvalMode")}
          disabled={disabled}
          onValueChange={(value) => {
            void onSettingsChange(applyApprovalMode(settings, value), "approvalPolicy");
          }}
          value={deriveApprovalMode(settings)}
          options={[
            { value: "on-request", label: t("settings:approval.onRequest") },
            { value: "auto-review", label: t("settings:approval.autoReview") },
            { value: "never", label: t("settings:approval.never") },
          ]}
        />
      ) : null}
      {control !== "approval" && sandboxModeSelectable ? (
        <>
          <CompactSelector<AgentSandboxMode>
            label={t("composer.sandboxMode")}
            disabled={disabled}
            onValueChange={(value) => {
              void onSettingsChange(
                {
                  ...settings,
                  sandboxMode: value,
                },
                "sandboxMode",
              );
            }}
            value={settings.sandboxMode}
            options={[
              { value: "read-only", label: t("settings:sandbox.readOnly") },
              { value: "workspace-write", label: t("settings:sandbox.workspaceWrite") },
              { value: "danger-full-access", label: t("settings:sandbox.dangerFullAccess") },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
