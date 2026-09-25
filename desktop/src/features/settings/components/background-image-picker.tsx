import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../shared/components/core/dialog.js";
import { BingBackgroundSettings } from "./bing-background-settings.js";
import { CustomBackgroundGallery } from "./custom-background-gallery.js";
import type { WorkbenchBackgroundSettingsProps } from "./workbench-background-settings.js";

export function BackgroundImagePicker({ onClose, ...props }: WorkbenchBackgroundSettingsProps & Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation("settings");
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="wallpaper-picker">
      <div className="flex items-start justify-between gap-4">
        <div><DialogTitle>{t("wallpaper.choose")}</DialogTitle><DialogDescription className="mt-1">{t("wallpaper.pickerDescription")}</DialogDescription></div>
        <Button aria-label={t("wallpaper.closePicker")} size="icon-sm" variant="ghost" onClick={onClose}><X aria-hidden="true" /></Button>
      </div>
      <div className="wallpaper-picker-body">
        {props.preference.mode === "bing" ? <BingBackgroundSettings preference={props.preference} onChange={props.onPreferenceChange} /> : <CustomBackgroundGallery {...props} />}
      </div>
      <DialogFooter className="border-t border-separator pt-4"><Button variant="outline" onClick={onClose}>{t("wallpaper.done")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
