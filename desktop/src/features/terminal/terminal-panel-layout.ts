export function clampTerminalHeight(height: number, available: number): number {
  const maximum = Math.max(0, available - 240);
  return Math.min(maximum, Math.max(Math.min(160, maximum), Number.isFinite(height) ? height : 280));
}
