import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { DEFAULT_WORKBENCH_BACKGROUND, type WorkbenchBackgroundPreference, type CustomBackgroundImage } from "../workbench-background-preference.js";

export function WallpaperAction({ label, children, onClick, disabled = false }: Readonly<{
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean;
}>) {
  return <Tooltip><TooltipTrigger asChild><Button aria-label={label} disabled={disabled} onClick={onClick} size="icon-sm" type="button" variant="ghost">{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

export function useCustomWallpaperSource(image: CustomBackgroundImage | undefined) {
  const [blobSource, setBlobSource] = useState<Readonly<{ blob: Blob; url: string }> | null>(null);
  const blob = image?.blob;
  useEffect(() => {
    if (blob === null || blob === undefined) return;
    const url = URL.createObjectURL(blob);
    setBlobSource({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return blob ? (blobSource?.blob === blob ? blobSource.url : null) : image?.assetUrl ?? null;
}

export function WallpaperAdjustments({ preference, onChange }: Readonly<{
  preference: WorkbenchBackgroundPreference; onChange: (value: WorkbenchBackgroundPreference) => void;
}>) {
  const { t } = useTranslation("settings");
  if (preference.mode === "none") return null;
  return <section className="wallpaper-adjustments">
    <div className="wallpaper-section-heading"><h2>{t("wallpaper.adjustments")}</h2>
      <WallpaperAction label={t("wallpaper.reset")} onClick={() => onChange({ ...preference, blurPercentage: DEFAULT_WORKBENCH_BACKGROUND.blurPercentage, overlayOpacity: DEFAULT_WORKBENCH_BACKGROUND.overlayOpacity })}><RotateCcw aria-hidden="true" /></WallpaperAction>
    </div>
    <div className="wallpaper-sliders">
      {([{ key: "overlayOpacity", label: "background.overlayOpacityLabel", aria: "background.overlayOpacity" }, { key: "blurPercentage", label: "background.blurLabel", aria: "background.blur" }] as const).map(({ key, label, aria }) => (
        <label className="wallpaper-slider" key={key}>
          <span>{t(label)}<output>{preference[key]}%</output></span>
          <input aria-label={t(aria)} type="range" min={0} max={95} step={1} value={preference[key]} onChange={(event) => onChange({ ...preference, [key]: Number(event.currentTarget.value) })} />
        </label>
      ))}
    </div>
  </section>;
}

export function WallpaperImageDialog({ source, title, onClose, children, error = false }: Readonly<{
  source: string | null; title: string; onClose: () => void; children?: ReactNode; error?: boolean;
}>) {
  const { t } = useTranslation("settings");
  const [failed, setFailed] = useState(false);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="wallpaper-dialog" aria-describedby={undefined}>
      <div className="wallpaper-section-heading"><DialogTitle>{title}</DialogTitle><WallpaperAction label={t("wallpaper.close")} onClick={onClose}><X aria-hidden="true" /></WallpaperAction></div>
      <div className="wallpaper-original">
        {error || failed ? <span role="alert">{t("wallpaper.imageError")}</span> : source === null ? <LoaderCircle aria-label={t("wallpaper.loading")} className="size-5 motion-safe:animate-spin" /> : <img alt={title} src={source} onError={() => setFailed(true)} />}
      </div>
      {children}
    </DialogContent>
  </Dialog>;
}
