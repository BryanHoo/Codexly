export const PET_POSITION_STORAGE_KEY = "codexly.workbench-pet-position";

export type PetPositionPreference = Readonly<{
  version: 1;
  xRatio: number;
  yRatio: number;
}>;
export type PetPixelPosition = Readonly<{ x: number; y: number }>;
export type PetPositionBounds = Readonly<{
  height: number;
  petHeight: number;
  petWidth: number;
  width: number;
}>;

export const DEFAULT_PET_POSITION: PetPositionPreference = {
  version: 1,
  xRatio: 1,
  yRatio: 1,
};

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function readPetPositionPreference(
  storage: Pick<Storage, "getItem">,
): PetPositionPreference {
  try {
    const value = JSON.parse(
      storage.getItem(PET_POSITION_STORAGE_KEY) ?? "null",
    ) as Partial<PetPositionPreference> | null;
    return value?.version === 1 && isRatio(value.xRatio) && isRatio(value.yRatio)
      ? { version: 1, xRatio: value.xRatio, yRatio: value.yRatio }
      : DEFAULT_PET_POSITION;
  } catch {
    return DEFAULT_PET_POSITION;
  }
}

export function writePetPositionPreference(
  storage: Pick<Storage, "setItem">,
  preference: PetPositionPreference,
): void {
  try {
    storage.setItem(PET_POSITION_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // 浏览器禁用持久化时保留当前会话位置，不影响拖动。
  }
}

function movableRange(bounds: PetPositionBounds): Readonly<{ x: number; y: number }> {
  return {
    x: Math.max(0, bounds.width - bounds.petWidth),
    y: Math.max(0, bounds.height - bounds.petHeight),
  };
}

export function clampPetPosition(
  position: PetPixelPosition,
  bounds: PetPositionBounds,
): PetPixelPosition {
  const range = movableRange(bounds);
  return {
    x: Math.min(range.x, Math.max(0, position.x)),
    y: Math.min(range.y, Math.max(0, position.y)),
  };
}

export function petPositionFromRatio(
  preference: PetPositionPreference,
  bounds: PetPositionBounds,
): PetPixelPosition {
  const range = movableRange(bounds);
  return { x: range.x * preference.xRatio, y: range.y * preference.yRatio };
}

export function petPositionToRatio(
  position: PetPixelPosition,
  bounds: PetPositionBounds,
): PetPositionPreference {
  const range = movableRange(bounds);
  const clamped = clampPetPosition(position, bounds);
  return {
    version: 1,
    xRatio: range.x === 0 ? 1 : clamped.x / range.x,
    yRatio: range.y === 0 ? 1 : clamped.y / range.y,
  };
}
