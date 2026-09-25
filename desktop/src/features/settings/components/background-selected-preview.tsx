import { useQuery } from "@tanstack/react-query";
import { ImagePlus, ImageOff, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { CustomBackgroundImage, WorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { useCustomWallpaperSource } from "./wallpaper-controls.js";
import { bingImageQuery } from "./bing-wallpaper-queries.js";

function Thumbnail({ source, loading = false }: Readonly<{ source: string | null; loading?: boolean }>) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <div className="background-summary-image" aria-hidden="true">
    {source !== null && source !== failedSource ? <img alt="" src={source} decoding="async" onError={() => setFailedSource(source)} /> : loading ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : source ? <ImageOff className="size-5" /> : <ImagePlus className="size-5" />}
  </div>;
}

export function CustomBackgroundPreview({ image }: Readonly<{ image: CustomBackgroundImage | undefined }>) {
  const { t } = useTranslation("settings");
  const source = useCustomWallpaperSource(image);
  return <><Thumbnail source={source} /><div className="background-summary-text"><p title={image?.name}>{image?.name ?? t("wallpaper.addFavorite")}</p><span>{t(image ? "wallpaper.customSelected" : "wallpaper.customFormats")}</span></div></>;
}

export function BingBackgroundPreview({ preference }: Readonly<{ preference: WorkbenchBackgroundPreference }>) {
  const { t } = useTranslation("settings");
  // 摘要只请求当前图片的缩略图，不拉取九天图库或原图。
  const image = useQuery(bingImageQuery(preference.selectedBingDay, true));
  return <><Thumbnail source={image.data ?? null} loading={image.isPending} /><div className="background-summary-text"><p>{t("background.bingAria")}</p><span>{image.isError ? t("wallpaper.imageError") : preference.selectedBingDay ?? t("wallpaper.daily")}</span></div></>;
}
