// 日期格式器只保留最近使用的时区，避免编辑期间反复创建 Intl 对象或无限增长缓存。
let cachedTimezone = "";
let cachedFormatter: Intl.DateTimeFormat;

export function zonedDateTime(unixMs: number, timezone: string): string {
  if (cachedTimezone !== timezone) {
    cachedFormatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    cachedTimezone = timezone;
  }
  const parts = cachedFormatter.formatToParts(unixMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

export function wallTimeToUnix(value: string, timezone: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/u.test(value)) return undefined;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const wall = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== normalized) return undefined;
  // 纯日期校验直接走 UTC 数值，不反复切换时区格式器缓存。
  if (timezone === "UTC") return wall;
  try {
    let candidate = wall;
    // 两次偏移修正覆盖时区和夏令时切换；回读校验拒绝不存在的墙钟时间。
    for (let attempt = 0; attempt < 3; attempt++) {
      const formatted = zonedDateTime(candidate, timezone);
      if (formatted === normalized) return candidate;
      candidate += wall - Date.parse(`${formatted}Z`);
    }
  } catch { return undefined; }
  return undefined;
}
