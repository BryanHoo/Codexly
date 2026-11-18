import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import { BingBackgroundSettings } from "./bing-background-settings.js";
import { CustomBackgroundGallery } from "./custom-background-gallery.js";
import type { WorkbenchBackgroundSettingsProps } from "./workbench-background-settings-contracts.js";

export function BackgroundImagePicker({
  onClose,
  ...props
}: WorkbenchBackgroundSettingsProps & Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation("settings");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("wallpaper.closePicker")} className="wallpaper-picker">
        <DialogHeader className="gap-1">
          <DialogTitle>{t("wallpaper.choose")}</DialogTitle>
          <DialogDescription>{t("wallpaper.pickerDescription")}</DialogDescription>
        </DialogHeader>
        <div className="wallpaper-picker-body">
          {props.preference.mode === "bing" ? (
            <BingBackgroundSettings
              preference={props.preference}
              onChange={props.onPreferenceChange}
            />
          ) : (
            <CustomBackgroundGallery {...props} />
          )}
        </div>
        <DialogFooter className="border-t border-separator pt-4">
          <Button variant="outline" onClick={onClose}>
            {t("wallpaper.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
