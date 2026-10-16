import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { applyWorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";
import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";
import { SettingsSaveStatus } from "@codexly/ui/core/settings-save-status";
import type { SettingsSaveStatus as SaveStatus } from "@codexly/frontend-core/settings-autosave";

export function BackgroundSettingsField() {
  const { t } = useTranslation("settings");
  const draft = useWorkbenchBackgroundDraft();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [retry, setRetry] = useState(0);
  const dirty = useRef(false);
  const queue = useRef(Promise.resolve());
  const { background, backgroundMutation, customBackgroundMissing } = draft;
  // 仅用户修改后提交；初始化图库不能触发写入或覆盖已保存的图片。
  useEffect(() => {
    if (!dirty.current || customBackgroundMissing) return;
    queue.current = queue.current
      .catch(() => undefined)
      .then(() => {
        setSaveStatus("saving");
        return applyWorkbenchBackgroundPreference(background, backgroundMutation);
      })
      .then(
        () => {
          setSaveStatus("saved");
        },
        () => {
          setSaveStatus("error");
        },
      );
  }, [background, backgroundMutation, customBackgroundMissing, retry]);
  return (
    <div>
      <WorkbenchBackgroundSettings
        customImages={draft.customImages}
        disabled={draft.isLoading || draft.loadError}
        loadError={draft.loadError}
        onRetry={draft.retryLoad}
        preference={background}
        onCustomFilesAdd={(files) => {
          dirty.current = true;
          draft.addCustomBackgroundFiles(files);
        }}
        onCustomImageRemove={(id) => {
          dirty.current = true;
          draft.removeCustomBackgroundImage(id);
        }}
        onCustomImageSelect={(id) => {
          dirty.current = true;
          draft.selectCustomBackgroundImage(id);
        }}
        onPreferenceChange={(value) => {
          dirty.current = true;
          draft.setBackground(value);
        }}
      />
      <SettingsSaveStatus
        status={saveStatus}
        labels={{
          saving: t("actions.saving"),
          saved: t("actions.saved"),
          saveError: t("errors.save"),
          retry: t("common:actions.retry"),
        }}
        onRetry={() => {
          setRetry((value) => value + 1);
        }}
      />
    </div>
  );
}
