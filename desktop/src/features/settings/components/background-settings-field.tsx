import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";

export function BackgroundSettingsField() {
  // 仅启用自定义背景时读取图库；通用设置默认不触发图片 I/O。
  const draft = useWorkbenchBackgroundDraft();
  return <WorkbenchBackgroundSettings
    customImages={draft.customImages}
    disabled={draft.isLoading || draft.isSavingImages || draft.loadError}
    loadError={draft.loadError}
    onRetry={draft.retryLoad}
    onCustomFilesAdd={draft.addCustomBackgroundFiles}
    onCustomImageRemove={draft.removeCustomBackgroundImage}
    onCustomImageSelect={draft.selectCustomBackgroundImage}
    onPreferenceChange={draft.setBackground}
    preference={draft.background}
  />;
}
