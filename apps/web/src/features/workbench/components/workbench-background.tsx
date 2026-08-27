import { useEffect, useState, type ReactNode } from "react";

import {
  DEFAULT_WORKBENCH_BACKGROUND,
  readCustomBackgroundImage,
  readWorkbenchBackgroundPreference,
  WORKBENCH_BACKGROUND_CHANGED_EVENT,
  type WorkbenchBackgroundPreference,
} from "../../settings/workbench-background-preference.js";

export type WorkbenchBackgroundTone = "dark" | "light";

const BACKGROUND_SAMPLE_SIZE = 32;
const EQUAL_BLACK_WHITE_CONTRAST_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

function getLinearColorChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function getBackgroundToneFromPixels(
  pixels: Uint8ClampedArray,
): WorkbenchBackgroundTone | null {
  const luminances: number[] = [];
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    const red = getLinearColorChannel(pixels[offset] ?? 0);
    const green = getLinearColorChannel(pixels[offset + 1] ?? 0);
    const blue = getLinearColorChannel(pixels[offset + 2] ?? 0);
    luminances.push(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  }
  if (luminances.length === 0) return null;

  // 中位数能抑制小面积高光与阴影，阈值取黑白前景对比度相等时的相对亮度。
  luminances.sort((first, second) => first - second);
  const medianLuminance = luminances[Math.floor(luminances.length / 2)] ?? 0;
  return medianLuminance > EQUAL_BLACK_WHITE_CONTRAST_LUMINANCE ? "light" : "dark";
}

export function detectWorkbenchBackgroundTone(
  image: HTMLImageElement,
): WorkbenchBackgroundTone | null {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = BACKGROUND_SAMPLE_SIZE;
    canvas.height = BACKGROUND_SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(image, 0, 0, BACKGROUND_SAMPLE_SIZE, BACKGROUND_SAMPLE_SIZE);
    return getBackgroundToneFromPixels(
      context.getImageData(0, 0, BACKGROUND_SAMPLE_SIZE, BACKGROUND_SAMPLE_SIZE).data,
    );
  } catch {
    // Canvas 被浏览器安全策略限制时保留当前主题配色，不能阻断壁纸显示。
    return null;
  }
}

function formatDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function createBingWallpaperUrl(date: Date): string {
  const day = `${String(date.getFullYear())}-${formatDatePart(date.getMonth() + 1)}-${formatDatePart(date.getDate())}`;
  return `/v1/workbench-background/bing?day=${day}`;
}

export function getMillisecondsUntilNextLocalDay(date: Date): number {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1_000, nextDay.getTime() - date.getTime() + 1_000);
}

export function getWorkbenchBackgroundBlurRadius(percentage: number): number {
  // UI 使用统一的 0–95% 刻度，渲染半径限制在 20px，避免全屏图片产生过高滤镜开销。
  return Math.round(((percentage / 95) * 20 + Number.EPSILON) * 100) / 100;
}

export function WorkbenchBackgroundFrame({
  backgroundTone,
  children,
  imageLoaded,
  imageSource,
  onImageError,
  onImageLoad,
  preference,
}: Readonly<{
  backgroundTone: WorkbenchBackgroundTone | null;
  children: ReactNode;
  imageLoaded: boolean;
  imageSource: string | null;
  onImageError: () => void;
  onImageLoad: (image: HTMLImageElement) => void;
  preference: WorkbenchBackgroundPreference;
}>) {
  return (
    <div
      className="workbench-background h-full min-h-0 overflow-hidden"
      data-background-mode={preference.mode}
      data-background-tone={backgroundTone ?? undefined}
      data-has-image={imageLoaded}
      data-workbench-background="true"
    >
      {imageSource === null ? null : (
        <img
          alt=""
          aria-hidden="true"
          className="workbench-background__image"
          data-workbench-background-image="true"
          decoding="async"
          onError={onImageError}
          onLoad={(event) => {
            onImageLoad(event.currentTarget);
          }}
          src={imageSource}
          style={{
            filter:
              preference.blurPercentage === 0
                ? undefined
                : `blur(${String(getWorkbenchBackgroundBlurRadius(preference.blurPercentage))}px)`,
            opacity: imageLoaded ? 1 : 0,
          }}
        />
      )}
      {imageLoaded ? (
        <div
          aria-hidden="true"
          className="workbench-background__overlay"
          data-workbench-background-overlay="true"
          style={{ opacity: preference.overlayOpacity / 100 }}
        />
      ) : null}
      {children}
    </div>
  );
}

export function WorkbenchBackground({ children }: Readonly<{ children: ReactNode }>) {
  const [backgroundTone, setBackgroundTone] = useState<WorkbenchBackgroundTone | null>(null);
  const [preference, setPreference] = useState<WorkbenchBackgroundPreference>(() =>
    typeof window === "undefined"
      ? DEFAULT_WORKBENCH_BACKGROUND
      : readWorkbenchBackgroundPreference(window.localStorage),
  );
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const [bingImageUrl, setBingImageUrl] = useState(() => createBingWallpaperUrl(new Date()));
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        const nextPreference = event.detail as WorkbenchBackgroundPreference;
        setPreference(nextPreference);
      }
    };
    window.addEventListener(WORKBENCH_BACKGROUND_CHANGED_EVENT, handlePreferenceChange);
    return () => {
      window.removeEventListener(WORKBENCH_BACKGROUND_CHANGED_EVENT, handlePreferenceChange);
    };
  }, []);

  useEffect(() => {
    // 每次图片修订都重建 Object URL，并在模式切换或卸载时立即释放浏览器内存。
    if (preference.mode !== "custom") {
      setCustomImageUrl(null);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    const selectedImageId = preference.selectedCustomImageId;
    if (selectedImageId === null) {
      setCustomImageUrl(null);
      return;
    }
    void readCustomBackgroundImage(selectedImageId)
      .then((image) => {
        if (disposed || image === null) return;
        objectUrl = URL.createObjectURL(image);
        setCustomImageUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setCustomImageUrl(null);
      });
    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [preference.mode, preference.selectedCustomImageId]);

  useEffect(() => {
    // 使用浏览器本地午夜作为换日边界，避免长时间打开工作台后继续显示昨日壁纸。
    if (preference.mode !== "bing") return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNextDay = () => {
      timeoutId = setTimeout(() => {
        setBingImageUrl(createBingWallpaperUrl(new Date()));
        scheduleNextDay();
      }, getMillisecondsUntilNextLocalDay(new Date()));
    };
    scheduleNextDay();
    return () => {
      clearTimeout(timeoutId);
    };
  }, [preference.mode]);

  const imageSource =
    preference.mode === "custom"
      ? customImageUrl
      : preference.mode === "bing"
        ? bingImageUrl
        : null;
  useEffect(() => {
    setImageLoaded(false);
    setBackgroundTone(null);
  }, [imageSource]);

  return (
    <WorkbenchBackgroundFrame
      backgroundTone={backgroundTone}
      imageLoaded={imageLoaded}
      imageSource={imageSource}
      onImageError={() => {
        setImageLoaded(false);
        setBackgroundTone(null);
      }}
      onImageLoad={(image) => {
        setBackgroundTone(detectWorkbenchBackgroundTone(image));
        setImageLoaded(true);
      }}
      preference={preference}
    >
      {children}
    </WorkbenchBackgroundFrame>
  );
}
