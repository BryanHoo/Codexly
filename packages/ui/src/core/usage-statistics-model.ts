import type { TokenUsageCounters, TokenUsageResponse } from "@codexly/protocol";
export const usageFields = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;
const counters = ["totalTokens", ...usageFields] as const;

/** 使用 UTC 日历避免夏令时与设备时区变化导致格子错位；一年最多 366 个日期。 */
export function usageCalendar(year: number): (string | null)[] {
  const first = new Date(Date.UTC(year, 0, 1));
  const result: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = first; day.getUTCFullYear() === year; day = new Date(day.getTime() + 86_400_000))
    result.push(day.toISOString().slice(0, 10));
  while (result.length % 7) result.push(null);
  return result;
}
export function summarizeUsage(rows: TokenUsageResponse["days"]) {
  const totals: { -readonly [K in keyof TokenUsageCounters]: TokenUsageCounters[K] } = {
    totalTokens: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
  const partialFields = new Set<(typeof usageFields)[number]>();
  const days = new Map<string, number>();
  const months = Array.from({ length: 12 }, () => 0);
  const engines = { codex: 0, claude: 0 };
  for (const row of rows) {
    const reportedBreakdown = usageFields.reduce((sum, field) => sum + (row[field] ?? 0), 0);
    for (const field of usageFields)
      if (
        (row.totalTokens ?? 0) > 0 &&
        (row[field] === null || reportedBreakdown < (row.totalTokens ?? 0))
      )
        partialFields.add(field);
    for (const key of counters) if (row[key] !== null) totals[key] = (totals[key] ?? 0) + row[key];
    const total = row.totalTokens ?? 0;
    days.set(row.day, (days.get(row.day) ?? 0) + total);
    const month = Number(row.day.slice(5, 7)) - 1;
    months[month] = (months[month] ?? 0) + total;
    engines[row.engine] += total;
  }
  let activeDays = 0,
    peakTokens = 0,
    peakDay: string | null = null;
  for (const [day, total] of days) {
    if (total > 0) activeDays += 1;
    if (total > peakTokens) {
      peakTokens = total;
      peakDay = day;
    }
  }
  return { ...totals, days, months, engines, activeDays, peakTokens, peakDay, partialFields };
}
