import type { WorkbenchPetFrame } from "@codexly/protocol";

export async function loadPetBitmap(assetUrl: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(assetUrl, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Unable to load pet asset: ${String(response.status)}`);
  return createImageBitmap(await response.blob());
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
