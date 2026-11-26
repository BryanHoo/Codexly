import { readFile } from "node:fs/promises";

import { imageDimensionsFromData } from "image-dimensions";

export type PetImageMetadata = Readonly<{
  contentType: "image/png" | "image/webp";
  height: number;
  width: number;
}>;

export type WebpDimensions = Readonly<{ height: number; width: number }>;

export function readPetImageMetadata(data: Uint8Array): PetImageMetadata {
  const dimensions = imageDimensionsFromData(data);
  if (dimensions?.type !== "png" && dimensions?.type !== "webp") {
    throw new Error("Pet spritesheet must be a valid PNG or WebP image");
  }
  return {
    contentType: dimensions.type === "png" ? "image/png" : "image/webp",
    height: dimensions.height,
    width: dimensions.width,
  };
}

export async function readPetImageMetadataFromFile(path: string): Promise<PetImageMetadata> {
  return readPetImageMetadata(await readFile(path));
}

export function readWebpDimensions(data: Uint8Array): WebpDimensions {
  // 内置 CDN 资源固定为 WebP，自定义资源则与 Codex 一致支持 PNG 和 WebP。
  const metadata = readPetImageMetadata(data);
  if (metadata.contentType !== "image/webp") {
    throw new Error("Pet spritesheet must be a valid WebP image");
  }
  return metadata;
}

export async function readWebpDimensionsFromFile(path: string): Promise<WebpDimensions> {
  return readWebpDimensions(await readFile(path));
}
