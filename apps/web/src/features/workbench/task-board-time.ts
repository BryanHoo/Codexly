export function formatTaskBoardElapsed(startedAt: string, now = Date.now()): string | null {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(now)) return null;

  const elapsedMinutes = Math.max(0, Math.floor((now - startedAtMs) / 60_000));
  if (elapsedMinutes < 1) return "<1m";
  if (elapsedMinutes < 60) return `${String(elapsedMinutes)}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  if (elapsedHours < 24) {
    return `${String(elapsedHours)}h${remainingMinutes > 0 ? ` ${String(remainingMinutes)}m` : ""}`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  const remainingHours = elapsedHours % 24;
  return `${String(elapsedDays)}d${remainingHours > 0 ? ` ${String(remainingHours)}h` : ""}`;
}
