import { Check, Image, ImageOff, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import {
  isSupportedCustomBackgroundImage,
  type CustomBackgroundImage,
  type WorkbenchBackgroundMode,
  type WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";

const backgroundModes = [
  { ariaKey: "background.noneAria", icon: ImageOff, labelKey: "background.none", value: "none" },
  { ariaKey: "background.customAria", icon: Image, labelKey: "background.custom", value: "custom" },
  { ariaKey: "background.bingAria", icon: Sparkles, labelKey: "background.bing", value: "bing" },
] as const;

function BackgroundRangeField({
  ariaLabel,
  disabled,
  id,
  label,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: number) => void;
  value: number;
}>) {
  return (
    <div className="space-y-1">
      <label className="text-label font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3">
        <input
          aria-label={ariaLabel}
          className="h-11 w-full accent-brand sm:h-8"
          disabled={disabled}
          id={id}
          max="95"
          min="0"
          onChange={(event) => {
            onChange(Number(event.currentTarget.value));
          }}
          step="1"
          type="range"
          value={value}
        />
        <output
          className="text-right text-body-small tabular-nums text-muted-foreground"
          htmlFor={id}
        >
          {value}%
        </output>
      </div>
    </div>
  );
}

function CustomBackgroundThumbnail({
  disabled,
  image,
  onRemove,
  onSelect,
  selected,
}: Readonly<{
  disabled: boolean;
  image: CustomBackgroundImage;
  onRemove: () => void;
  onSelect: () => void;
  selected: boolean;
}>) {
  const { t } = useTranslation("settings");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(image.blob);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [image.blob]);

  return (
    <div className="group relative aspect-square min-w-0">
      <button
        aria-label={t("background.selectImage", { name: image.name })}
        aria-pressed={selected}
        className={`size-full overflow-hidden rounded-control border-2 bg-control outline-none transition-colors focus-visible:shadow-focus ${selected ? "border-brand" : "border-transparent hover:border-separator-strong"}`}
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        {previewUrl === null ? null : (
          <img
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
            decoding="async"
            src={previewUrl}
          />
        )}
      </button>
      {selected ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-brand text-brand-contrast shadow-control"
        >
          <Check className="size-3.5" />
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("background.deleteImage", { name: image.name })}
            className="absolute right-1 top-1 size-7 bg-dialog/95 text-foreground opacity-100 shadow-control sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            disabled={disabled}
            onClick={onRemove}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("background.delete")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function WorkbenchBackgroundSettings({
  customImages,
  disabled,
  onCustomFilesAdd,
  onCustomImageRemove,
  onCustomImageSelect,
  onPreferenceChange,
  preference,
}: Readonly<{
  customImages: readonly CustomBackgroundImage[];
  disabled: boolean;
  onCustomFilesAdd: (files: readonly File[]) => void;
  onCustomImageRemove: (imageId: string) => void;
  onCustomImageSelect: (imageId: string) => void;
  onPreferenceChange: (preference: WorkbenchBackgroundPreference) => void;
  preference: WorkbenchBackgroundPreference;
}>) {
  const { t } = useTranslation("settings");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectMode = (mode: WorkbenchBackgroundMode) => {
    onPreferenceChange({ ...preference, mode });
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid grid-cols-3 rounded-control bg-control p-0.5">
        {backgroundModes.map(({ ariaKey, icon: Icon, labelKey, value }) => (
          <Button
            aria-label={t(ariaKey)}
            aria-pressed={preference.mode === value}
            className={
              preference.mode === value
                ? "h-8 gap-1 px-1 text-body-small text-foreground shadow-control"
                : "h-8 gap-1 px-1 text-body-small"
            }
            disabled={disabled}
            key={value}
            onClick={() => {
              selectMode(value);
            }}
            type="button"
            variant={preference.mode === value ? "secondary" : "ghost"}
          >
            <Icon aria-hidden="true" className="hidden size-4 min-[360px]:block" />
            <span>{t(labelKey)}</span>
          </Button>
        ))}
      </div>

      {preference.mode === "custom" ? (
        <div className="space-y-3">
          <div
            aria-label={t("background.galleryLabel")}
            className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5"
            role="group"
          >
            {customImages.map((image) => (
              <CustomBackgroundThumbnail
                disabled={disabled}
                image={image}
                key={image.id}
                onRemove={() => {
                  onCustomImageRemove(image.id);
                }}
                onSelect={() => {
                  onCustomImageSelect(image.id);
                }}
                selected={preference.selectedCustomImageId === image.id}
              />
            ))}
            <button
              aria-label={t("background.uploadInput")}
              className="flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-control border border-dashed border-separator-strong bg-control text-label text-muted-foreground outline-none transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                inputRef.current?.click();
              }}
              type="button"
            >
              <Upload aria-hidden="true" className="size-4" />
              <span>{t("background.upload")}</span>
            </button>
          </div>
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            aria-label={t("background.uploadInput")}
            className="hidden"
            multiple
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              if (files.length === 0) return;
              if (files.some((file) => !isSupportedCustomBackgroundImage(file))) {
                setUploadError(t("background.invalidImage"));
                event.currentTarget.value = "";
                return;
              }
              setUploadError(null);
              onCustomFilesAdd(files);
              event.currentTarget.value = "";
            }}
            ref={inputRef}
            type="file"
          />
          {customImages.length === 0 ? (
            <p className="text-label text-muted-foreground">{t("background.uploadRequired")}</p>
          ) : null}
          {uploadError === null ? null : (
            <p className="text-label text-danger" role="alert">
              {uploadError}
            </p>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        <BackgroundRangeField
          ariaLabel={t("background.overlayOpacity")}
          disabled={disabled || preference.mode === "none"}
          id="background-opacity"
          label={t("background.overlayOpacityLabel")}
          onChange={(overlayOpacity) => {
            onPreferenceChange({ ...preference, overlayOpacity });
          }}
          value={preference.overlayOpacity}
        />
        <BackgroundRangeField
          ariaLabel={t("background.blur")}
          disabled={disabled || preference.mode === "none"}
          id="background-blur"
          label={t("background.blurLabel")}
          onChange={(blurPercentage) => {
            onPreferenceChange({ ...preference, blurPercentage });
          }}
          value={preference.blurPercentage}
        />
      </div>
    </div>
  );
}
