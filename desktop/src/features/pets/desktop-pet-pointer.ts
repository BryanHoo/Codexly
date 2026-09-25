interface PointerCaptureTarget {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

export function releaseDesktopPetPointerCapture(
  target: PointerCaptureTarget,
  pointerId: number,
): void {
  if (target.hasPointerCapture(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}
