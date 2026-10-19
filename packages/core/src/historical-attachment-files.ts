import { Buffer } from "node:buffer";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";

import type { AgentImageMediaType } from "@codexly/protocol";

export type HistoricalFileStats = Readonly<{ isFile: boolean; mtimeMs: number; size: number }>;

export const imageMediaTypesByExtension: Readonly<Record<string, AgentImageMediaType>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const imageExtensionsByMediaType: Readonly<Record<AgentImageMediaType, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export { detectImageMediaType } from "./historical-image-media-type.js";

export function normalizeAttachmentName(value: string | undefined, fallback: string): string {
  const trimmedName = value?.trim();
  return trimmedName === undefined || trimmedName.length === 0
    ? fallback
    : trimmedName.slice(0, 255);
}

export function readFileHeader(path: string): Buffer {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(12);
    const bytesRead = readSync(file, header, 0, header.byteLength, 0);
    return header.subarray(0, bytesRead);
  } finally {
    closeSync(file);
  }
}

export function readFileStats(path: string): HistoricalFileStats {
  const stats = statSync(path);
  return { isFile: stats.isFile(), mtimeMs: stats.mtimeMs, size: stats.size };
}

export async function readFileStatsAsync(path: string): Promise<HistoricalFileStats> {
  const stats = await stat(path);
  return { isFile: stats.isFile(), mtimeMs: stats.mtimeMs, size: stats.size };
}
