import { useEffect, useState, type ReactNode } from "react";

import {
  DEFAULT_WORKBENCH_BACKGROUND,
  readCustomBackgroundImage,
  readWorkbenchBackgroundPreference,
  WORKBENCH_BACKGROUND_CHANGED_EVENT,
  type WorkbenchBackgroundPreference,
} from "../../settings/workbench-background-preference.js";

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
  children,
  imageLoaded,
  imageSource,
  onImageError,
  onImageLoad,
  preference,
}: Readonly<{
  children: ReactNode;
  imageLoaded: boolean;
  imageSource: string | null;
  onImageError: () => void;
  onImageLoad: () => void;
  preference: WorkbenchBackgroundPreference;
}>) {
  return (
    <div
      className="workbench-background h-full min-h-0 overflow-hidden"
      data-background-mode={preference.mode}
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
          onLoad={onImageLoad}
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
  const [preference, setPreference] = useState<WorkbenchBackgroundPreference>(() =>
    typeof window === "undefined"
      ? DEFAULT_WORKBENCH_BACKGROUND
      : readWorkbenchBackgroundPreference(window.localStorage),
  );
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const [customImageRevision, setCustomImageRevision] = useState(0);
  const [bingImageUrl, setBingImageUrl] = useState(() => createBingWallpaperUrl(new Date()));
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        const nextPreference = event.detail as WorkbenchBackgroundPreference;
        setPreference(nextPreference);
        if (nextPreference.mode === "custom") {
          setCustomImageRevision((revision) => revision + 1);
        }
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
    void readCustomBackgroundImage()
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
  }, [customImageRevision, preference.mode, preference.customImageName]);

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
  }, [imageSource]);

  return (
    <WorkbenchBackgroundFrame
      imageLoaded={imageLoaded}
      imageSource={imageSource}
      onImageError={() => {
        setImageLoaded(false);
      }}
      onImageLoad={() => {
        setImageLoaded(true);
      }}
      preference={preference}
    >
      {children}
    </WorkbenchBackgroundFrame>
  );
}
