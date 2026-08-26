import { readFile } from "node:fs/promises";

import { imageDimensionsFromData } from "image-dimensions";

export type WebpDimensions = Readonly<{ height: number; width: number }>;

export function readWebpDimensions(data: Uint8Array): WebpDimensions {
  // 宠物资源仅允许 WebP，避免扩展通用图片解析器带来的额外攻击面。
  const dimensions = imageDimensionsFromData(data);
  if (dimensions?.type !== "webp") {
    throw new Error("Pet spritesheet must be a valid WebP image");
  }
  return dimensions;
}

export async function readWebpDimensionsFromFile(path: string): Promise<WebpDimensions> {
  return readWebpDimensions(await readFile(path));
}
