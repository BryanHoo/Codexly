import type { WorkbenchPetAnimation } from "../../protocol/index.js";

type ScreenPosition = Readonly<{ x: number; y: number }>;

const DRAG_DIRECTION_THRESHOLD = 4;
const PRIMARY_POINTER_BUTTON = 1;

export function dragAnimation(originX: number, currentX: number): string | null {
  const deltaX = currentX - originX;
  if (Math.abs(deltaX) < DRAG_DIRECTION_THRESHOLD) return null;
  return deltaX < 0 ? "running-left" : "running-right";
}

export function isDesktopPetDragPointerActive(buttons: number): boolean {
  return (buttons & PRIMARY_POINTER_BUTTON) !== 0;
}

export function desktopPetDragPosition(
  origin: ScreenPosition,
  pointerOrigin: ScreenPosition,
  pointer: ScreenPosition,
  scaleFactor: number,
): ScreenPosition {
  return {
    x: Math.round(origin.x + (pointer.x - pointerOrigin.x) * scaleFactor),
    y: Math.round(origin.y + (pointer.y - pointerOrigin.y) * scaleFactor),
  };
}

export function introDuration(animation: WorkbenchPetAnimation | undefined): number {
  if (animation === undefined) return 0;
  const end = animation.loopStart ?? animation.frames.length;
  return animation.frames.slice(0, end).reduce((total, frame) => total + frame.durationMs, 0);
}
