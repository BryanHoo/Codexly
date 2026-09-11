import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { applyWorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";
import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";
import { Button } from "../../../shared/components/core/button.js";

export function BackgroundSettingsField() {
  const { t } = useTranslation("settings");
  const draft = useWorkbenchBackgroundDraft();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const dirty = useRef(false);
  const queue = useRef(Promise.resolve());
  const { background, backgroundMutation, customBackgroundMissing } = draft;
  // 仅用户修改后提交；初始化图库不能触发写入或覆盖已保存的图片。
  useEffect(() => {
    if (!dirty.current || customBackgroundMissing) return;
    queue.current = queue.current
      .catch(() => undefined)
      .then(() => applyWorkbenchBackgroundPreference(background, backgroundMutation))
      .then(
        () => {
          setError(false);
        },
        () => {
          setError(true);
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
      {error ? (
        <div role="alert" className="text-body-small text-danger">
          {t("personalization.saveError")}
          <Button
            variant="ghost"
            onClick={() => {
              setRetry((value) => value + 1);
            }}
          >
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
