import "../../../i18n/settings-background.js";
import "./workbench-background-settings.css";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import type { CustomBackgroundImage, WorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import { SettingsField } from "./global-settings-fields.js";
import { WallpaperAdjustments } from "./wallpaper-controls.js";
import { BingBackgroundPreview, CustomBackgroundPreview } from "./background-selected-preview.js";

// 图库和原图交互仅在打开选择弹窗后加载，关闭背景时不创建图片查询。
const BackgroundImagePicker = lazy(() => import("./background-image-picker.js").then((module) => ({ default: module.BackgroundImagePicker })));
const backgroundModes = [
  { ariaKey: "background.noneAria", labelKey: "background.none", value: "none" },
  { ariaKey: "background.bingAria", labelKey: "wallpaper.bingMode", value: "bing" },
  { ariaKey: "background.customAria", labelKey: "background.custom", value: "custom" },
] as const;

export type WorkbenchBackgroundSettingsProps = Readonly<{
  customImages: readonly CustomBackgroundImage[];
  disabled: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  onCustomFilesAdd: (files: readonly File[]) => void;
  onCustomImageRemove: (imageId: string) => void;
  onCustomImageSelect: (imageId: string) => void;
  onPreferenceChange: (preference: WorkbenchBackgroundPreference) => void;
  preference: WorkbenchBackgroundPreference;
}>;


export function WorkbenchBackgroundSettings(props: WorkbenchBackgroundSettingsProps) {
  const { preference, customImages, onPreferenceChange } = props;
  const { t } = useTranslation("settings");
  const [pickerOpen, setPickerOpen] = useState(false);
  return <div className="wallpaper-settings">
    <SettingsField label={t("background.label")} description={t("wallpaper.description")}>
      <div className="background-mode-control" role="group" aria-label={t("wallpaper.source")}>
        {backgroundModes.map(({ ariaKey, labelKey, value }) => (
          <Button key={value} aria-label={t(ariaKey)} aria-pressed={preference.mode === value}
            className={preference.mode === value ? "bg-raised text-foreground shadow-control" : "text-muted-foreground"}
            onClick={() => onPreferenceChange({ ...preference, mode: value })} type="button" variant="ghost">{t(labelKey)}</Button>
        ))}
      </div>
    </SettingsField>
    {preference.mode === "none" ? null : <div className="background-details">
      <div className="background-summary">
        {preference.mode === "bing" ? <BingBackgroundPreview preference={preference} />
          : <CustomBackgroundPreview image={customImages.find((image) => image.id === preference.selectedCustomImageId)} />}
        <Button variant="outline" type="button" onClick={() => setPickerOpen(true)}>{t("wallpaper.choose")}</Button>
      </div>
      <WallpaperAdjustments preference={preference} onChange={onPreferenceChange} />
    </div>}
    {pickerOpen ? <Suspense fallback={<span role="status" className="px-4 text-label text-muted-foreground">{t("wallpaper.loading")}</span>}>
      <BackgroundImagePicker {...props} onClose={() => setPickerOpen(false)} />
    </Suspense> : null}
  </div>;
}
