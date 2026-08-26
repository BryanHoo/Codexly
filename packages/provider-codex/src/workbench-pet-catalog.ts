import type { WorkbenchPetAnimation, WorkbenchPetDescriptor } from "@codexly/protocol";

export const PET_PACK_VERSION = "v1";
export const PET_CDN_BASE_URL = "https://persistent.oaistatic.com/codex/pets/v1";
export const PET_FRAME = { columns: 8, height: 208, rows: 9, width: 192 } as const;
export const PET_SPRITESHEET = { height: 1_872, width: 1_536 } as const;

export type BuiltinPet = Readonly<{
  description: string;
  displayName: string;
  file: string;
  id: string;
}>;

export const BUILTIN_PETS: readonly BuiltinPet[] = [
  {
    description: "The original Codex companion",
    displayName: "Codex",
    file: "codex-spritesheet-v4.webp",
    id: "codex",
  },
  {
    description: "A tidy duck for calm workspace days",
    displayName: "Dewey",
    file: "dewey-spritesheet-v4.webp",
    id: "dewey",
  },
  {
    description: "Hot path energy for fast iteration",
    displayName: "Fireball",
    file: "fireball-spritesheet-v4.webp",
    id: "fireball",
  },
  {
    description: "A steady rock when the diff gets large",
    displayName: "Rocky",
    file: "rocky-spritesheet-v4.webp",
    id: "rocky",
  },
  {
    description: "Small green shoots for new ideas",
    displayName: "Seedy",
    file: "seedy-spritesheet-v4.webp",
    id: "seedy",
  },
  {
    description: "A balanced stack for deep work",
    displayName: "Stacky",
    file: "stacky-spritesheet-v4.webp",
    id: "stacky",
  },
  {
    description: "A tiny blue-screen gremlin",
    displayName: "BSOD",
    file: "bsod-spritesheet-v4.webp",
    id: "bsod",
  },
  {
    description: "Quiet signal from the void",
    displayName: "Null Signal",
    file: "null-signal-spritesheet-v4.webp",
    id: "null-signal",
  },
];

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

export function createDefaultPetAnimations(): Readonly<Record<string, WorkbenchPetAnimation>> {
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
  } satisfies Record<string, WorkbenchPetAnimation>;
  return {
    ...tracks,
    bounce: tracks.jumping,
    move_left: tracks["running-left"],
    move_right: tracks["running-right"],
    sad: tracks.failed,
    wave: tracks.waving,
  };
}

export function createBuiltinDescriptor(
  pet: BuiltinPet,
  assetId: string,
  availability: WorkbenchPetDescriptor["availability"],
): WorkbenchPetDescriptor {
  return {
    animations: createDefaultPetAnimations(),
    assetId,
    availability,
    description: pet.description,
    displayName: pet.displayName,
    frame: PET_FRAME,
    id: pet.id,
    source: "builtin",
  };
}
