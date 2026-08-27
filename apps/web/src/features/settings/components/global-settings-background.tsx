import { useTranslation } from "../../../i18n/i18n.js";
import type {
  CustomBackgroundImage,
  WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";
import { SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";
import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";

export function GlobalSettingsBackground({
  activeSection,
  customImages,
  disabled,
  onCustomFilesAdd,
  onCustomImageRemove,
  onCustomImageSelect,
  onPreferenceChange,
  preference,
}: Readonly<{
  activeSection: SettingsSectionId;
  customImages: readonly CustomBackgroundImage[];
  disabled: boolean;
  onCustomFilesAdd: (files: readonly File[]) => void;
  onCustomImageRemove: (imageId: string) => void;
  onCustomImageSelect: (imageId: string) => void;
  onPreferenceChange: (preference: WorkbenchBackgroundPreference) => void;
  preference: WorkbenchBackgroundPreference;
}>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsPanel activeSection={activeSection} id="background" title={t("sections.background")}>
      <div className="py-3">
        <WorkbenchBackgroundSettings
          customImages={customImages}
          disabled={disabled}
          onCustomFilesAdd={onCustomFilesAdd}
          onCustomImageRemove={onCustomImageRemove}
          onCustomImageSelect={onCustomImageSelect}
          onPreferenceChange={onPreferenceChange}
          preference={preference}
        />
      </div>
    </SettingsPanel>
  );
}
