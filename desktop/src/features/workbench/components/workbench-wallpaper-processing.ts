export type PhysicalWallpaperSize = Readonly<{
  height: number;
  width: number;
}>;

export type WallpaperCoverRect = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

function toPositiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getPhysicalWallpaperSize(
  logicalWidth: number,
  logicalHeight: number,
  pixelRatio: number,
): PhysicalWallpaperSize {
  const safePixelRatio = toPositiveFinite(pixelRatio, 1);
  return {
    height: Math.max(1, Math.ceil(toPositiveFinite(logicalHeight, 1) * safePixelRatio)),
    width: Math.max(1, Math.ceil(toPositiveFinite(logicalWidth, 1) * safePixelRatio)),
  };
}

export function getWallpaperCoverRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  samplingPadding: number,
): WallpaperCoverRect {
  const safeSourceWidth = toPositiveFinite(sourceWidth, 1);
  const safeSourceHeight = toPositiveFinite(sourceHeight, 1);
  const safeTargetWidth = toPositiveFinite(targetWidth, 1);
  const safeTargetHeight = toPositiveFinite(targetHeight, 1);
  const safePadding = Math.max(0, toPositiveFinite(samplingPadding, 0));
  const paddedWidth = safeTargetWidth + safePadding * 2;
  const paddedHeight = safeTargetHeight + safePadding * 2;
  const scale = Math.max(paddedWidth / safeSourceWidth, paddedHeight / safeSourceHeight);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  return {
    height,
    width,
    x: (safeTargetWidth - width) / 2,
    y: (safeTargetHeight - height) / 2,
  };
}

export async function drawPreprocessedWallpaper(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  size: PhysicalWallpaperSize,
  logicalBlurRadius: number,
  pixelRatio: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return false;

  const context = canvas.getContext("2d");
  if (context === null) return false;

  const physicalBlurRadius = Math.max(0, logicalBlurRadius * toPositiveFinite(pixelRatio, 1));
  // 按需加载兼容算法；异步加载完成后先取消旧任务，避免快速调整时旧结果覆盖新参数。
  const supportsFilter = "filter" in context;
  const software = physicalBlurRadius > 0 && !supportsFilter
    ? await import("./workbench-wallpaper-blur.js") : null;
  if (signal?.aborted) return false;
  canvas.width = size.width;
  canvas.height = size.height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (software !== null) return software.drawSoftwareBlur(context, image, size, physicalBlurRadius);
  // 扩大绘制范围，为模糊核提供边缘像素，避免画布四周出现透明暗边。
  const cover = getWallpaperCoverRect(
    image.naturalWidth,
    image.naturalHeight,
    size.width,
    size.height,
    Math.ceil(physicalBlurRadius * 3),
  );
  if (supportsFilter) context.filter = physicalBlurRadius > 0 ? `blur(${String(physicalBlurRadius)}px)` : "none";
  context.drawImage(image, cover.x, cover.y, cover.width, cover.height);
  if (supportsFilter) context.filter = "none";
  return true;
}

export function loadWallpaperImage(
  source: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";

    const release = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleLoad = () => {
      release();
      resolve(image);
    };
    const handleError = () => {
      release();
      reject(new Error("Wallpaper image decoding failed"));
    };
    const handleAbort = () => {
      release();
      image.src = "";
      reject(new DOMException("Wallpaper image decoding aborted", "AbortError"));
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    image.src = source;
  });
}
