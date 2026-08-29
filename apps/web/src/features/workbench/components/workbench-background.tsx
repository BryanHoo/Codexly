import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  DEFAULT_WORKBENCH_BACKGROUND,
  readCustomBackgroundImage,
  readWorkbenchBackgroundPreference,
  WORKBENCH_BACKGROUND_CHANGED_EVENT,
  type WorkbenchBackgroundPreference,
} from "../../settings/workbench-background-preference.js";
import {
  createWorkbenchBackgroundRenderKey,
  drawWorkbenchBackground,
  readWorkbenchBackgroundPixels,
} from "./workbench-background-canvas.js";

export type WorkbenchBackgroundTone = "dark" | "light";

const EQUAL_BLACK_WHITE_CONTRAST_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;
const RESIZE_DRAW_DELAY_MS = 120;

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
  // UI 使用统一的 0–95% 刻度，预处理半径限制在 20px，控制重新绘制成本。
  return Math.round(((percentage / 95) * 20 + Number.EPSILON) * 100) / 100;
}

export function WorkbenchBackgroundFrame({
  backgroundTone,
  canvasRef,
  children,
  imageLoaded,
  preference,
}: Readonly<{
  backgroundTone: WorkbenchBackgroundTone | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  children: ReactNode;
  imageLoaded: boolean;
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
      {preference.mode === "none" ? null : (
        <canvas
          aria-hidden="true"
          className="workbench-background__canvas"
          data-workbench-background-canvas="true"
          ref={canvasRef}
          style={{ opacity: imageLoaded ? 1 : 0 }}
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderKeyRef = useRef<string | null>(null);

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
    renderKeyRef.current = null;
  }, [imageSource]);

  useEffect(() => {
    if (imageSource === null) return;
    let disposed = false;
    let resizeTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let renderGeneration = 0;
    let resolutionQuery: MediaQueryList | undefined;

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas === null || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
      const bounds = canvas.getBoundingClientRect();
      const input = {
        blurRadius: getWorkbenchBackgroundBlurRadius(preference.blurPercentage),
        devicePixelRatio: Math.max(1, window.devicePixelRatio || 1),
        height: bounds.height,
        source: imageSource,
        width: bounds.width,
      };
      const renderKey = createWorkbenchBackgroundRenderKey(input);
      if (renderKeyRef.current === renderKey) return;
      const generation = ++renderGeneration;
      void drawWorkbenchBackground(canvas, input)
        .then(() => {
          if (disposed || generation !== renderGeneration) return;
          renderKeyRef.current = renderKey;
          const pixels = readWorkbenchBackgroundPixels(canvas);
          setBackgroundTone(pixels === null ? null : getBackgroundToneFromPixels(pixels));
          setImageLoaded(true);
        })
        .catch(() => {
          if (disposed || generation !== renderGeneration) return;
          renderKeyRef.current = null;
          setBackgroundTone(null);
          setImageLoaded(false);
        });
    };
    const scheduleDraw = () => {
      clearTimeout(resizeTimeoutId);
      resizeTimeoutId = setTimeout(draw, RESIZE_DRAW_DELAY_MS);
    };
    const watchDevicePixelRatio = () => {
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
      resolutionQuery = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
      resolutionQuery.addEventListener("change", handleResolutionChange);
    };
    function handleResolutionChange() {
      watchDevicePixelRatio();
      scheduleDraw();
    }

    draw();
    watchDevicePixelRatio();
    window.addEventListener("resize", scheduleDraw);
    return () => {
      disposed = true;
      renderGeneration += 1;
      clearTimeout(resizeTimeoutId);
      window.removeEventListener("resize", scheduleDraw);
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
    };
  }, [imageSource, preference.blurPercentage]);

  return (
    <WorkbenchBackgroundFrame
      backgroundTone={backgroundTone}
      canvasRef={canvasRef}
      imageLoaded={imageLoaded}
      preference={preference}
    >
      {children}
    </WorkbenchBackgroundFrame>
  );
}
