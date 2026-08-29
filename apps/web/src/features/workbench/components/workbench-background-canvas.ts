export interface WorkbenchBackgroundRenderInput {
  blurRadius: number;
  devicePixelRatio: number;
  height: number;
  source: string;
  width: number;
}

interface DrawRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export function getCanvasPhysicalSize(width: number, height: number, dpr: number) {
  return {
    height: Math.max(1, Math.round(height * dpr)),
    width: Math.max(1, Math.round(width * dpr)),
  };
}

export function createWorkbenchBackgroundRenderKey(input: WorkbenchBackgroundRenderInput): string {
  return [input.source, input.width, input.height, input.devicePixelRatio, input.blurRadius].join(
    "\u0000",
  );
}

export function getCoverDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  blurRadius: number,
): DrawRect {
  const expandedWidth = targetWidth + blurRadius * 2;
  const expandedHeight = targetHeight + blurRadius * 2;
  const scale = Math.max(expandedWidth / sourceWidth, expandedHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    height,
    width,
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
  };
}

function decodeImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  return image.decode().then(() => image);
}

export async function drawWorkbenchBackground(
  canvas: HTMLCanvasElement,
  input: WorkbenchBackgroundRenderInput,
): Promise<void> {
  const image = await decodeImage(input.source);
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error("Decoded workbench background has no dimensions");
  }

  const physicalSize = getCanvasPhysicalSize(input.width, input.height, input.devicePixelRatio);
  canvas.width = physicalSize.width;
  canvas.height = physicalSize.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D context is unavailable");

  const drawRect = getCoverDrawRect(
    image.naturalWidth,
    image.naturalHeight,
    input.width,
    input.height,
    input.blurRadius,
  );
  const dpr = input.devicePixelRatio;
  context.clearRect(0, 0, physicalSize.width, physicalSize.height);
  context.save();
  if (input.blurRadius > 0) {
    // 模糊在物理像素 backing store 内一次完成，正常合成阶段无需 CSS filter。
    context.filter = `blur(${String(input.blurRadius * dpr)}px)`;
  }
  context.drawImage(
    image,
    drawRect.x * dpr,
    drawRect.y * dpr,
    drawRect.width * dpr,
    drawRect.height * dpr,
  );
  context.restore();
}

export function readWorkbenchBackgroundPixels(canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  try {
    const sample = document.createElement("canvas");
    sample.width = 32;
    sample.height = 32;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    return context.getImageData(0, 0, sample.width, sample.height).data;
  } catch {
    // 跨源图片污染 Canvas 时保留当前主题配色，但不阻断壁纸显示。
    return null;
  }
}
