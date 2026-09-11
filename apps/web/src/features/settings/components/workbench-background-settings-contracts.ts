import type {
  CustomBackgroundImage,
  WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";
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
