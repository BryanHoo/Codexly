import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  WorkbenchPetAnimation,
  WorkbenchPetDescriptor,
  WorkbenchPetFrame,
} from "@codexly/protocol";
import { createDefaultPetAnimations, PET_FRAME } from "./workbench-pet-catalog.js";
import { readWebpDimensionsFromFile } from "./workbench-pet-image.js";

const MAX_MANIFEST_BYTES = 64 * 1_024;
const MAX_CUSTOM_ASSET_BYTES = 16 * 1_024 * 1_024;
const MAX_FRAMES = 256;
const MAX_FPS = 60;

export type PetAssetRecord = Readonly<{
  assetId: string;
  baseDirectory: string;
  descriptor: WorkbenchPetDescriptor;
  path: string;
}>;

export async function loadCustomPet(input: {
  assetId: string;
  directory: string;
  folder: string;
  manifestName: "avatar.json" | "pet.json";
  source: "custom" | "legacy";
}): Promise<PetAssetRecord> {
  const baseDirectory = await realpath(input.directory);
  const manifestPath = resolve(baseDirectory, input.manifestName);
  const manifestStats = await stat(manifestPath);
  if (!manifestStats.isFile() || manifestStats.size > MAX_MANIFEST_BYTES) {
    throw new Error("Pet manifest is missing or too large");
  }
  const raw = await readFile(manifestPath, "utf8");
  const manifest = parseRecord(JSON.parse(raw) as unknown, "Pet manifest");
  const spritesheetPath = readOptionalString(manifest, "spritesheetPath") ?? "spritesheet.webp";
  if (isAbsolute(spritesheetPath) || spritesheetPath.split(/[\\/]/u).includes("..")) {
    throw new Error("Pet spritesheet must stay inside its directory");
  }
  const path = await realpath(resolve(baseDirectory, spritesheetPath));
  assertContained(baseDirectory, path);
  const assetStats = await stat(path);
  if (!assetStats.isFile() || assetStats.size > MAX_CUSTOM_ASSET_BYTES) {
    throw new Error("Pet spritesheet is missing or too large");
  }
  const dimensions = await readWebpDimensionsFromFile(path);
  const frame = parseFrame(manifest["frame"]);
  const frameCount = validateFrame(frame, dimensions.width, dimensions.height);
  const animations = parseAnimations(manifest["animations"], frameCount);
  const manifestId = readOptionalString(manifest, "id");
  return {
    assetId: input.assetId,
    baseDirectory,
    descriptor: {
      animations,
      assetId: input.assetId,
      availability: "ready",
      description: readOptionalString(manifest, "description") ?? "",
      displayName: readOptionalString(manifest, "displayName") ?? manifestId ?? input.folder,
      frame,
      id: `custom:${input.folder}`,
      source: input.source,
    },
    path,
  };
}

export async function validatePetAsset(record: PetAssetRecord): Promise<{
  mtimeMs: number;
  size: number;
}> {
  const [baseDirectory, resolved] = await Promise.all([
    realpath(record.baseDirectory),
    realpath(record.path),
  ]);
  assertContained(baseDirectory, resolved);
  const assetStats = await stat(resolved);
  if (!assetStats.isFile() || assetStats.size > MAX_CUSTOM_ASSET_BYTES) {
    throw new Error("Pet spritesheet is unavailable");
  }
  const dimensions = await readWebpDimensionsFromFile(resolved);
  validateFrame(record.descriptor.frame, dimensions.width, dimensions.height);
  return { mtimeMs: assetStats.mtimeMs, size: assetStats.size };
}

function parseFrame(value: unknown): WorkbenchPetFrame {
  if (value === undefined || value === null) return PET_FRAME;
  const frame = parseRecord(value, "Pet frame");
  return {
    columns: readPositiveInteger(frame, "columns"),
    height: readPositiveInteger(frame, "height"),
    rows: readPositiveInteger(frame, "rows"),
    width: readPositiveInteger(frame, "width"),
  };
}

function validateFrame(
  frame: WorkbenchPetFrame,
  width: number | undefined,
  height: number | undefined,
): number {
  if (
    width === undefined ||
    height === undefined ||
    frame.width * frame.columns !== width ||
    frame.height * frame.rows !== height
  ) {
    throw new Error("Pet frame grid must cover the spritesheet exactly");
  }
  const frameCount = frame.columns * frame.rows;
  if (frameCount > MAX_FRAMES) throw new Error("Pet frame count exceeds the maximum");
  return frameCount;
}

function parseAnimations(
  value: unknown,
  frameCount: number,
): Readonly<Record<string, WorkbenchPetAnimation>> {
  const defaults = createDefaultPetAnimations();
  if (value === undefined || value === null) return defaults;
  const source = parseRecord(value, "Pet animations");
  if (Object.keys(source).length === 0) return defaults;
  const animations: Record<string, WorkbenchPetAnimation> = { ...defaults };
  for (const [name, raw] of Object.entries(source)) {
    const spec = parseRecord(raw, `Pet animation ${name}`);
    const frames = spec["frames"];
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error(`Pet animation ${name} requires frames`);
    }
    const spriteIndices = frames.map((frame) => {
      if (!Number.isInteger(frame) || Number(frame) < 0 || Number(frame) >= frameCount) {
        throw new Error(`Pet animation ${name} has an invalid frame`);
      }
      return Number(frame);
    });
    const fps = spec["fps"] === undefined ? 8 : Number(spec["fps"]);
    if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) {
      throw new Error(`Pet animation ${name} has an invalid fps`);
    }
    const loops = spec["loop"] === undefined ? true : spec["loop"];
    if (typeof loops !== "boolean") throw new Error(`Pet animation ${name} has an invalid loop`);
    animations[name] = {
      fallback: readOptionalString(spec, "fallback") ?? "idle",
      frames: spriteIndices.map((spriteIndex) => ({
        durationMs: Math.max(1, Math.round(1_000 / fps)),
        spriteIndex,
      })),
      loopStart: loops ? 0 : null,
    };
  }
  for (const [name, animation] of Object.entries(animations)) {
    if (animations[animation.fallback] === undefined) {
      throw new Error(`Pet animation ${name} has an unknown fallback`);
    }
  }
  return animations;
}

function assertContained(base: string, target: string): void {
  const child = relative(base, target);
  if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) {
    return;
  }
  throw new Error("Pet asset escapes its directory");
}

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Pet ${key} must be a string`);
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`Pet frame ${key} must be a positive integer`);
  }
  return Number(value);
}
