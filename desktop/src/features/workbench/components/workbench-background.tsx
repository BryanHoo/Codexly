import { useEffect, useRef, useState, type ReactNode } from "react";

import { appPreferenceStorage } from "@/platform/tauri/app-storage.js";
import { buildNativeAssetUrl } from "@/platform/native-asset-url.js";
import { nativeClient } from "../../projects/project-queries.js";

import {
  readCustomBackgroundImageSource,
  readWorkbenchBackgroundPreference,
  WORKBENCH_BACKGROUND_CHANGED_EVENT,
  type WorkbenchBackgroundPreference,
} from "../../settings/workbench-background-preference.js";
import {
  drawPreprocessedWallpaper,
  getPhysicalWallpaperSize,
  loadWallpaperImage,
  type PhysicalWallpaperSize,
} from "./workbench-wallpaper-processing.js";

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

type WorkbenchBackgroundClient = Readonly<{
  getWorkbenchBackground: (day?: string) => Promise<Readonly<{ assetPath: string }>>;
}>;

export async function loadBingWallpaperSource(
  day: string | null,
  client: WorkbenchBackgroundClient = nativeClient,
  toAssetUrl: (path: string) => string = buildNativeAssetUrl,
): Promise<string> {
  const response = await client.getWorkbenchBackground(day ?? undefined);
  return toAssetUrl(response.assetPath);
}

export function getMillisecondsUntilNextLocalDay(date: Date): number {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1_000, nextDay.getTime() - date.getTime() + 1_000);
}

export function getWorkbenchBackgroundBlurRadius(percentage: number): number {
  // UI 使用统一的 0–95% 刻度，预处理半径限制在 20px，避免生成阶段开销过高。
  return Math.round(((percentage / 95) * 20 + Number.EPSILON) * 100) / 100;
}

type WallpaperViewport = PhysicalWallpaperSize & Readonly<{ pixelRatio: number }>;

function readWallpaperViewport(): WallpaperViewport {
  const pixelRatio = window.devicePixelRatio || 1;
  return {
    ...getPhysicalWallpaperSize(window.innerWidth, window.innerHeight, pixelRatio),
    pixelRatio,
  };
}

function useWallpaperViewport(): WallpaperViewport {
  const [viewport, setViewport] = useState(readWallpaperViewport);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const updateViewport = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      // 合并连续窗口缩放，拖拽结束后只重新生成一次物理像素画布。
      timeoutId = setTimeout(() => {
        const nextViewport = readWallpaperViewport();
        setViewport((current) =>
          current.width === nextViewport.width &&
          current.height === nextViewport.height &&
          current.pixelRatio === nextViewport.pixelRatio
            ? current
            : nextViewport,
        );
      }, 120);
    };
    window.addEventListener("resize", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  return viewport;
}

export function WorkbenchBackgroundFrame({
  backgroundTone,
  canvasRef,
  children,
  imageLoaded,
  imageSource,
  preference,
}: Readonly<{
  backgroundTone: WorkbenchBackgroundTone | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  children: ReactNode;
  imageLoaded: boolean;
  imageSource: string | null;
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
        <canvas
          aria-hidden="true"
          className="workbench-background__image"
          data-workbench-background-image="true"
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
    readWorkbenchBackgroundPreference(appPreferenceStorage),
  );
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const [bingImageUrl, setBingImageUrl] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [decodedImage, setDecodedImage] = useState<Readonly<{
    image: HTMLImageElement;
    source: string;
  }> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewport = useWallpaperViewport();

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
    // 自定义背景由 Rust 动态授权单个文件，WebView 不复制图片字节即可直接解码。
    if (preference.mode !== "custom") {
      setCustomImageUrl(null);
      return;
    }
    let disposed = false;
    const selectedImageId = preference.selectedCustomImageId;
    if (selectedImageId === null) {
      setCustomImageUrl(null);
      return;
    }
    void readCustomBackgroundImageSource(selectedImageId)
      .then((source) => {
        if (!disposed) setCustomImageUrl(source);
      })
      .catch(() => {
        if (!disposed) setCustomImageUrl(null);
      });
    return () => {
      disposed = true;
    };
  }, [preference.mode, preference.selectedCustomImageId]);

  useEffect(() => {
    if (preference.mode !== "bing") {
      setBingImageUrl(null);
      return;
    }
    let disposed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const now = new Date();
      setBingImageUrl(null);
      // 固定日期不参与每日刷新；自动模式由后端选取最新真实日期，避免本地时区错配。
      void loadBingWallpaperSource(preference.selectedBingDay)
        .then((source) => {
          if (!disposed) setBingImageUrl(source);
        })
        .catch(() => {
          if (!disposed) setBingImageUrl(null);
        });
      if (preference.selectedBingDay === null) {
        timeoutId = setTimeout(refresh, getMillisecondsUntilNextLocalDay(now));
      }
    };
    refresh();
    return () => {
      disposed = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [preference.mode, preference.selectedBingDay]);

  const imageSource =
    preference.mode === "custom"
      ? customImageUrl
      : preference.mode === "bing"
        ? bingImageUrl
        : null;
  useEffect(() => {
    setImageLoaded(false);
    setBackgroundTone(null);
    setDecodedImage(null);
    if (imageSource === null) return;

    const controller = new AbortController();
    void loadWallpaperImage(imageSource, controller.signal)
      .then((image) => {
        if (!controller.signal.aborted) setDecodedImage({ image, source: imageSource });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDecodedImage(null);
      });
    return () => {
      controller.abort();
    };
  }, [imageSource]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || decodedImage === null || decodedImage.source !== imageSource) return;
    const controller = new AbortController();
    void drawPreprocessedWallpaper(
      canvas,
      decodedImage.image,
      viewport,
      getWorkbenchBackgroundBlurRadius(preference.blurPercentage),
      viewport.pixelRatio,
      controller.signal,
    ).then((rendered) => {
      if (controller.signal.aborted) return;
      setBackgroundTone(rendered ? detectWorkbenchBackgroundTone(decodedImage.image) : null);
      setImageLoaded(rendered);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setBackgroundTone(null);
      setImageLoaded(false);
    });
    return () => controller.abort();
  }, [decodedImage, imageSource, preference.blurPercentage, viewport]);

  return (
    <WorkbenchBackgroundFrame
      backgroundTone={backgroundTone}
      canvasRef={canvasRef}
      imageLoaded={imageLoaded}
      imageSource={imageSource}
      preference={preference}
    >
      {children}
    </WorkbenchBackgroundFrame>
  );
}
