import { useQuery } from "@tanstack/react-query";
import { Check, Download, LoaderCircle, Maximize2, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { BingWallpaper } from "../../../protocol/workbench-background.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { nativeClient } from "../../projects/project-queries.js";
import { notifyActionError, notifyActionSuccess } from "../../notifications/action-notifications.js";
import type { WorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import { WallpaperAction, WallpaperImageDialog } from "./wallpaper-controls.js";
import { bingImageQuery } from "./bing-wallpaper-queries.js";

function BingWallpaperTile({ image, selected, onSelect, onPreview, onDownload, downloading }: Readonly<{
  image: BingWallpaper; selected: boolean; onSelect: () => void; onPreview: () => void;
  onDownload: () => void; downloading: boolean;
}>) {
  const { t } = useTranslation("settings");
  const thumbnail = useQuery(bingImageQuery(image.day, true));
  const name = image.title || image.day;
  return <article className="wallpaper-tile" data-selected={selected}>
    <button className="wallpaper-thumbnail" type="button" aria-label={t("wallpaper.select", { name: image.day })} aria-pressed={selected} onClick={onSelect}>
      {thumbnail.data ? <img src={thumbnail.data} alt={name} loading="lazy" decoding="async" /> : <span className="wallpaper-thumbnail-state">{thumbnail.isError ? t("wallpaper.imageError") : <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />}</span>}
      {selected ? <span className="wallpaper-selected"><Check aria-hidden="true" className="size-3.5" />{t("wallpaper.selected")}</span> : null}
    </button>
    <div className="wallpaper-tile-footer"><div className="min-w-0"><p title={name}>{name}</p><time dateTime={image.day}>{image.day}</time></div>
      <div className="flex shrink-0">
        {thumbnail.isError ? <WallpaperAction label={t("wallpaper.retry")} onClick={() => { void thumbnail.refetch(); }}><RefreshCw aria-hidden="true" /></WallpaperAction> : null}
        <WallpaperAction label={t("wallpaper.view", { name: image.day })} onClick={onPreview}><Maximize2 aria-hidden="true" /></WallpaperAction>
        <WallpaperAction label={t("wallpaper.downloadImage", { name: image.day })} onClick={onDownload} disabled={downloading}><Download aria-hidden="true" /></WallpaperAction>
      </div>
    </div>
  </article>;
}

function BingImageDialog({ image, onClose, onDownload, downloading }: Readonly<{
  image: BingWallpaper; onClose: () => void; onDownload: () => void; downloading: boolean;
}>) {
  const { t } = useTranslation("settings");
  const source = useQuery(bingImageQuery(image.day, false));
  return <WallpaperImageDialog source={source.data ?? null} title={image.title || image.day} onClose={onClose} error={source.isError}>
    <div className="wallpaper-dialog-footer"><p>{image.day}<br />{image.copyright}</p>
      {source.isError ? <Button onClick={() => { void source.refetch(); }} variant="outline">{t("wallpaper.retry")}</Button> : null}
      <Button onClick={onDownload} disabled={downloading} variant="outline"><Download aria-hidden="true" />{t(downloading ? "wallpaper.downloading" : "wallpaper.download")}</Button>
    </div>
  </WallpaperImageDialog>;
}

export function BingBackgroundSettings({ preference, onChange }: Readonly<{
  preference: WorkbenchBackgroundPreference; onChange: (value: WorkbenchBackgroundPreference) => void;
}>) {
  const { t } = useTranslation("settings");
  const catalog = useQuery({ queryKey: ["bing-wallpapers"], queryFn: () => nativeClient.listWorkbenchBackgrounds(), staleTime: 60 * 60_000, retry: 1 });
  const images = catalog.data?.slice(0, 9) ?? [];
  const selectedDay = preference.selectedBingDay ?? images[0]?.day;
  const [previewImage, setPreviewImage] = useState<BingWallpaper | null>(null);
  const [downloading, setDownloading] = useState(false);
  const download = (day: string) => {
    if (downloading) return;
    setDownloading(true);
    void nativeClient.downloadWorkbenchBackground(day).then((result) => {
      if (result.status === "saved") notifyActionSuccess(t("wallpaper.downloaded", { name: result.fileName }));
    }).catch(notifyActionError).finally(() => setDownloading(false));
  };
  return <>
    <section>
      <div className="wallpaper-section-heading"><h2>{t("wallpaper.collection")}<span className="wallpaper-heading-meta">{t("wallpaper.recent")}</span></h2>
        <label className="wallpaper-daily"><input type="checkbox" checked={preference.selectedBingDay === null} disabled={images.length === 0} onChange={(event) => onChange({ ...preference, selectedBingDay: event.currentTarget.checked ? null : selectedDay ?? null })} />{t("wallpaper.daily")}</label>
      </div>
      {catalog.isError ? <div className="wallpaper-empty" role="alert"><p>{t("wallpaper.loadError")}</p><Button variant="outline" onClick={() => { void catalog.refetch(); }}><RefreshCw aria-hidden="true" />{t("wallpaper.retry")}</Button></div> : (
        <div className="wallpaper-gallery" aria-label={t("wallpaper.collection")}>
          {images.map((image) => <BingWallpaperTile key={image.day} image={image} selected={selectedDay === image.day} onSelect={() => onChange({ ...preference, selectedBingDay: image.day })} onPreview={() => setPreviewImage(image)} onDownload={() => download(image.day)} downloading={downloading} />)}
        </div>
      )}
    </section>
    {previewImage === null ? null : <BingImageDialog image={previewImage} onClose={() => setPreviewImage(null)} onDownload={() => download(previewImage.day)} downloading={downloading} />}
  </>;
}
