import { Image, ImageOff, Sparkles, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  isSupportedCustomBackgroundImage,
  readCustomBackgroundImage,
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
  max,
  onChange,
  suffix,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  id: string;
  label: string;
  max: number;
  onChange: (value: number) => void;
  suffix: string;
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
          max={max}
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
          {value}
          {suffix}
        </output>
      </div>
    </div>
  );
}

export function WorkbenchBackgroundSettings({
  customFile,
  disabled,
  onCustomFileChange,
  onPreferenceChange,
  preference,
}: Readonly<{
  customFile: File | null;
  disabled: boolean;
  onCustomFileChange: (file: File) => void;
  onPreferenceChange: (preference: WorkbenchBackgroundPreference) => void;
  preference: WorkbenchBackgroundPreference;
}>) {
  const { t } = useTranslation("settings");
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    const loadPreview = async () => {
      const image = customFile ?? (await readCustomBackgroundImage().catch(() => null));
      if (disposed || image === null) return;
      objectUrl = URL.createObjectURL(image);
      setPreviewUrl(objectUrl);
    };
    void loadPreview();
    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [customFile]);

  const selectMode = (mode: WorkbenchBackgroundMode) => {
    onPreferenceChange({ ...preference, mode });
  };

  return (
    <div className="min-w-0 space-y-3">
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
        <div className="space-y-2">
          {previewUrl === null ? null : (
            <div className="aspect-video overflow-hidden rounded-control border border-separator-strong bg-control">
              <img
                alt={t("background.previewAlt")}
                className="size-full object-cover"
                decoding="async"
                src={previewUrl}
              />
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <Button
              disabled={disabled}
              onClick={() => {
                inputRef.current?.click();
              }}
              size="compact"
              type="button"
              variant="outline"
            >
              <Upload aria-hidden="true" />
              {t("background.upload")}
            </Button>
            <span className="min-w-0 truncate text-label text-muted-foreground">
              {customFile?.name ?? preference.customImageName ?? t("background.uploadRequired")}
            </span>
          </div>
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            aria-label={t("background.uploadInput")}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file === undefined) return;
              if (!isSupportedCustomBackgroundImage(file)) {
                setUploadError(t("background.invalidImage"));
                event.currentTarget.value = "";
                return;
              }
              setUploadError(null);
              onCustomFileChange(file);
              onPreferenceChange({ ...preference, customImageName: file.name, mode: "custom" });
            }}
            ref={inputRef}
            type="file"
          />
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
          max={95}
          onChange={(overlayOpacity) => {
            onPreferenceChange({ ...preference, overlayOpacity });
          }}
          suffix="%"
          value={preference.overlayOpacity}
        />
        <BackgroundRangeField
          ariaLabel={t("background.blur")}
          disabled={disabled || preference.mode === "none"}
          id="background-blur"
          label={t("background.blurLabel")}
          max={95}
          onChange={(blurPercentage) => {
            onPreferenceChange({ ...preference, blurPercentage });
          }}
          suffix="%"
          value={preference.blurPercentage}
        />
      </div>
    </div>
  );
}
