import type {
  WorkbenchPetAnimation,
  WorkbenchPetDescriptor,
} from "@/protocol/index.js";

export type NativePetAssetRecord = Readonly<{
  animations?: Readonly<
    Record<
      string,
      Readonly<{
        fallback?: string | null;
        fps?: number | null;
        frames: number[];
        loop?: boolean | null;
      }>
    >
  > | null;
  assetId: string;
  assetPath?: string | null;
  availability: "downloadable" | "ready";
  description?: string | null;
  displayName?: string | null;
  frame?: Readonly<{ columns: number; height: number; rows: number; width: number }> | null;
  id: string;
  source: "builtin" | "custom" | "legacy";
}>;

export type NativePetCatalogResponse = Readonly<{ data: NativePetAssetRecord[] }>;
export type NativePetDownloadResponse = Readonly<{ data: NativePetAssetRecord }>;

const PET_FRAME = { columns: 8, height: 208, rows: 9, width: 192 } as const;
const PETS = {
  bsod: { description: "A tiny blue-screen companion", displayName: "BSOD" },
  codex: { description: "The original Codex companion", displayName: "Codex" },
  dewey: { description: "A tidy duck for calm workspace days", displayName: "Dewey" },
  fireball: { description: "Hot path energy for fast iteration", displayName: "Fireball" },
  "null-signal": { description: "Quiet signal from the void", displayName: "Null Signal" },
  rocky: { description: "A steady rock when the diff gets large", displayName: "Rocky" },
  seedy: { description: "Small green shoots for new ideas", displayName: "Seedy" },
  stacky: { description: "A balanced stack for deep work", displayName: "Stacky" },
} as const;

const idleFrames = [
  [0, 1_680],
  [1, 660],
  [2, 660],
  [3, 840],
  [4, 840],
  [5, 1_920],
] as const;

function idleAnimation(): WorkbenchPetAnimation {
  return {
    fallback: "idle",
    frames: idleFrames.map(([spriteIndex, durationMs]) => ({ durationMs, spriteIndex })),
    loopStart: 0,
  };
}

function stateAnimation(
  row: number,
  frameCount: number,
  durationMs: number,
  finalDurationMs: number,
): WorkbenchPetAnimation {
  const primary = Array.from({ length: frameCount }, (_, column) => ({
    durationMs: column === frameCount - 1 ? finalDurationMs : durationMs,
    spriteIndex: row * PET_FRAME.columns + column,
  }));
  return {
    fallback: "idle",
    frames: [...primary, ...primary, ...primary, ...idleAnimation().frames],
    loopStart: primary.length * 3,
  };
}

function createAnimations(): Readonly<Record<string, WorkbenchPetAnimation>> {
  const tracks = {
    failed: stateAnimation(5, 8, 140, 240),
    idle: idleAnimation(),
    jumping: stateAnimation(4, 5, 140, 280),
    review: stateAnimation(8, 6, 150, 280),
    "running-left": stateAnimation(2, 8, 120, 220),
    "running-right": stateAnimation(1, 8, 120, 220),
    running: stateAnimation(7, 6, 120, 220),
    waiting: stateAnimation(6, 6, 150, 260),
    waving: stateAnimation(3, 4, 140, 280),
  };
  return {
    ...tracks,
    bounce: tracks.jumping,
    move_left: tracks["running-left"],
    move_right: tracks["running-right"],
    sad: tracks.failed,
    wave: tracks.waving,
  };
}

export function mapNativePet(record: NativePetAssetRecord): WorkbenchPetDescriptor {
  if (
    !/^[a-f0-9]{64}$/u.test(record.assetId) ||
    (record.availability === "ready" && !record.assetPath)
  ) {
    throw new Error("Native workbench pet record is invalid");
  }
  if (record.source !== "builtin") return mapCustomPet(record);
  const metadata = PETS[record.id as keyof typeof PETS];
  if (metadata === undefined) throw new Error("Native workbench pet record is invalid");
  return {
    animations: createAnimations(),
    assetId: record.assetId,
    ...(record.assetPath ? { assetPath: record.assetPath } : {}),
    availability: record.availability,
    description: metadata.description,
    displayName: metadata.displayName,
    frame: PET_FRAME,
    id: record.id,
    source: "builtin",
  };
}

function mapCustomPet(record: NativePetAssetRecord): WorkbenchPetDescriptor {
  if (
    !record.id.startsWith("custom:") ||
    !record.assetPath ||
    !record.displayName ||
    !record.frame
  ) {
    throw new Error("Native custom workbench pet record is invalid");
  }
  const animations: Record<string, WorkbenchPetAnimation> = { ...createAnimations() };
  for (const [name, spec] of Object.entries(record.animations ?? {})) {
    const fps = spec.fps ?? 8;
    if (
      name.length === 0 ||
      spec.frames.length === 0 ||
      !Number.isFinite(fps) ||
      fps <= 0 ||
      fps > 60
    ) {
      throw new Error("Native custom workbench pet animation is invalid");
    }
    animations[name] = {
      fallback: spec.fallback ?? "idle",
      frames: spec.frames.map((spriteIndex) => ({
        durationMs: Math.max(1, Math.round(1_000 / fps)),
        spriteIndex,
      })),
      loopStart: (spec.loop ?? true) ? 0 : null,
    };
  }
  return {
    animations,
    assetId: record.assetId,
    assetPath: record.assetPath,
    availability: "ready",
    description: record.description ?? "",
    displayName: record.displayName,
    frame: record.frame,
    id: record.id,
    source: record.source,
  };
}
