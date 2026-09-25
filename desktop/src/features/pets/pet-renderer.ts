import type { WorkbenchPetFrame } from "@/protocol/index.js";

export function loadPetImage(assetUrl: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Pet asset loading was aborted", "AbortError"));
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    image.decoding = "async";
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Unable to load pet asset"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    // Tauri 的 asset protocol 支持图像加载，但在 WKWebView 中不能依赖 fetch 完成响应。
    image.src = assetUrl;
  });
}

export function drawPetFrame(
  canvas: HTMLCanvasElement,
  bitmap: CanvasImageSource,
  frame: WorkbenchPetFrame,
  spriteIndex: number,
): void {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D context is unavailable");
  const displayWidth = Math.max(1, canvas.clientWidth || frame.width);
  const displayHeight = Math.max(1, canvas.clientHeight || frame.height);
  const pixelRatio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.round(displayWidth * pixelRatio);
  const height = Math.round(displayHeight * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const column = spriteIndex % frame.columns;
  const row = Math.floor(spriteIndex / frame.columns);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    bitmap,
    column * frame.width,
    row * frame.height,
    frame.width,
    frame.height,
    0,
    0,
    width,
    height,
  );
}
