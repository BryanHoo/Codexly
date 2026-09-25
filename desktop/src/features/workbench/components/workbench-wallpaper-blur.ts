import { canvasRGBA } from "stackblur-canvas";
import { getWallpaperCoverRect, type PhysicalWallpaperSize } from "./workbench-wallpaper-processing.js";

export function drawSoftwareBlur(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  size: PhysicalWallpaperSize,
  radius: number,
): boolean {
  // WebKit 不支持 Canvas filter；限制软件采样尺寸，避免高分屏逐像素模糊占用主线程。
  const scale = Math.min(1, 1280 / Math.max(size.width, size.height));
  const buffer = document.createElement("canvas");
  buffer.width = Math.max(1, Math.ceil(size.width * scale));
  buffer.height = Math.max(1, Math.ceil(size.height * scale));
  const sampling = buffer.getContext("2d", { willReadFrequently: true });
  if (sampling === null) return false;
  const cover = getWallpaperCoverRect(image.naturalWidth, image.naturalHeight, buffer.width, buffer.height, 0);
  sampling.drawImage(image, cover.x, cover.y, cover.width, cover.height);
  // StackBlur 复用边缘像素，不会像透明边界卷积那样在画布四周产生暗边。
  canvasRGBA(buffer, 0, 0, buffer.width, buffer.height, Math.max(1, Math.min(254, Math.round(radius * scale * 1.5))));
  context.drawImage(buffer, 0, 0, size.width, size.height);
  return true;
}
