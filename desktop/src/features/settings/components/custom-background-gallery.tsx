import { Check, Maximize2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { isSupportedCustomBackgroundImage, type CustomBackgroundImage } from "../workbench-background-preference.js";
import { useCustomWallpaperSource, WallpaperAction, WallpaperImageDialog } from "./wallpaper-controls.js";
import type { WorkbenchBackgroundSettingsProps } from "./workbench-background-settings.js";

function CustomWallpaperTile({ image, selected, disabled, onSelect, onRemove, onPreview }: Readonly<{
  image: CustomBackgroundImage; selected: boolean; disabled: boolean;
  onSelect: () => void; onRemove: () => void; onPreview: () => void;
}>) {
  const { t } = useTranslation("settings");
  const source = useCustomWallpaperSource(image);
  return <article className="wallpaper-tile" data-selected={selected}>
    <button className="wallpaper-thumbnail" aria-label={t("background.selectImage", { name: image.name })} aria-pressed={selected} disabled={disabled} onClick={onSelect} type="button">
      {source === null ? null : <img alt={image.name} src={source} loading="lazy" decoding="async" />}
      {selected ? <span className="wallpaper-selected"><Check aria-hidden="true" className="size-3.5" />{t("wallpaper.selected")}</span> : null}
    </button>
    <div className="wallpaper-tile-footer"><p title={image.name}>{image.name}</p><div className="flex shrink-0">
      <WallpaperAction label={t("wallpaper.view", { name: image.name })} onClick={onPreview}><Maximize2 aria-hidden="true" /></WallpaperAction>
      <WallpaperAction label={t("background.deleteImage", { name: image.name })} onClick={onRemove} disabled={disabled}><Trash2 aria-hidden="true" /></WallpaperAction>
    </div></div>
  </article>;
}

function CustomWallpaperDialog({ image, onClose }: Readonly<{ image: CustomBackgroundImage; onClose: () => void }>) {
  const source = useCustomWallpaperSource(image);
  return <WallpaperImageDialog title={image.name} source={source} onClose={onClose} />;
}


export function CustomBackgroundGallery({
  customImages, disabled, loadError = false, onRetry, onCustomFilesAdd,
  onCustomImageRemove, onCustomImageSelect, preference,
}: WorkbenchBackgroundSettingsProps) {
  const { t } = useTranslation("settings");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<CustomBackgroundImage | null>(null);
  const upload = () => inputRef.current?.click();
  return <section>
        <div className="wallpaper-section-heading"><h2>{t("wallpaper.custom")}<span className="wallpaper-heading-meta">{customImages.length}</span></h2>
          <Button disabled={disabled} onClick={upload} type="button" variant="outline"><Upload aria-hidden="true" />{t("wallpaper.upload")}</Button>
        </div>
        {loadError ? <div className="wallpaper-empty" role="alert"><p>{t("wallpaper.loadError")}</p><Button onClick={onRetry} variant="outline"><RefreshCw aria-hidden="true" />{t("wallpaper.retry")}</Button></div> : customImages.length === 0 ? (
          <button className="wallpaper-upload-empty" disabled={disabled} onClick={upload} type="button" aria-label={t("background.uploadInput")}><Upload aria-hidden="true" className="size-5" /><span>{t("wallpaper.empty")}</span><span className="text-brand">{t("wallpaper.upload")}</span></button>
        ) : <div className="wallpaper-gallery" aria-label={t("background.galleryLabel")}>
          {customImages.map((image) => <CustomWallpaperTile image={image} key={image.id} selected={preference.selectedCustomImageId === image.id} disabled={disabled} onSelect={() => onCustomImageSelect(image.id)} onRemove={() => onCustomImageRemove(image.id)} onPreview={() => setPreviewImage(image)} />)}
        </div>}
        <input accept="image/gif,image/jpeg,image/png,image/webp" aria-label={t("background.uploadInput")} className="hidden" multiple ref={inputRef} type="file"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            if (files.length === 0) return;
            if (files.some((file) => !isSupportedCustomBackgroundImage(file))) { setUploadError(t("background.invalidImage")); return; }
            setUploadError(null);
            onCustomFilesAdd(files);
          }}
        />
        {uploadError === null ? null : <p className="mt-3 text-label text-danger" role="alert">{uploadError}</p>}

    {previewImage === null ? null : <CustomWallpaperDialog image={previewImage} onClose={() => setPreviewImage(null)} />}
  </section>;
}

