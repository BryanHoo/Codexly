import { ImagePreview as SharedImagePreview } from "@codexly/ui/core/image-preview";

import { useTranslation } from "../../../i18n/i18n.js";

export function ImagePreview({ alt, src }: Readonly<{ alt: string; src: string }>) {
  const { t } = useTranslation("common");
  return (
    <SharedImagePreview
      alt={alt}
      labels={{
        actualSize: t("imagePreview.actualSize"),
        fit: t("imagePreview.fit"),
        loadError: t("imagePreview.loadError"),
        loading: t("imagePreview.loading"),
        zoomIn: t("imagePreview.zoomIn"),
        zoomOut: t("imagePreview.zoomOut"),
      }}
      src={src}
    />
  );
}
