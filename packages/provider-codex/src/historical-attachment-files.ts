import { Buffer } from "node:buffer";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";

import type { AgentImageMediaType } from "@code-agent/protocol";

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

export function detectImageMediaType(content: Uint8Array): AgentImageMediaType | undefined {
  const header = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  const gifHeader = header.subarray(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }
  if (
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

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
