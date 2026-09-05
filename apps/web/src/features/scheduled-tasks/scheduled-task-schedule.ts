import type { ScheduledTaskSchedule } from "@codexly/protocol";

export type SchedulePreset = "once" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";
export type ScheduleDraft = Readonly<{ dateTime: string; preset: SchedulePreset; rrule: string }>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalDateTimeInput(unixMs: number): string {
  const date = new Date(unixMs);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultScheduleDraft(now = Date.now()): ScheduleDraft {
  const date = new Date(now + 60 * 60 * 1_000);
  date.setSeconds(0, 0);
  return { dateTime: toLocalDateTimeInput(date.getTime()), preset: "once", rrule: "" };
}

export function scheduleToDraft(schedule: ScheduledTaskSchedule): ScheduleDraft {
  if (schedule.type === "once") {
    return { dateTime: toLocalDateTimeInput(schedule.atUnixMs), preset: "once", rrule: "" };
  }
  const normalized = schedule.rrule.replace(/^RRULE:/u, "");
  const preset = normalized.startsWith("FREQ=DAILY;")
    ? "daily"
    : normalized.includes("BYDAY=MO,TU,WE,TH,FR")
      ? "weekdays"
      : normalized.startsWith("FREQ=WEEKLY;")
        ? "weekly"
        : normalized.startsWith("FREQ=MONTHLY;")
          ? "monthly"
          : "custom";
  return {
    dateTime: toLocalDateTimeInput(schedule.startAtUnixMs),
    preset,
    rrule: preset === "custom" ? schedule.rrule : "",
  };
}

export function draftToSchedule(
  draft: ScheduleDraft,
  timezone: string,
): ScheduledTaskSchedule | undefined {
  const startAtUnixMs = new Date(draft.dateTime).getTime();
  if (!Number.isFinite(startAtUnixMs)) return undefined;
  if (draft.preset === "once") return { atUnixMs: startAtUnixMs, type: "once" };
  if (draft.preset === "custom") {
    const rrule = draft.rrule.trim();
    return rrule === "" ? undefined : { rrule, startAtUnixMs, timezone, type: "rrule" };
  }
  const date = new Date(startAtUnixMs);
  const time = `BYHOUR=${String(date.getHours())};BYMINUTE=${String(date.getMinutes())}`;
  const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
  const weekday = weekdays[date.getDay()] ?? "SU";
  const recurrence =
    draft.preset === "daily"
      ? `FREQ=DAILY;${time}`
      : draft.preset === "weekdays"
        ? `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;${time}`
        : draft.preset === "weekly"
          ? `FREQ=WEEKLY;BYDAY=${weekday};${time}`
          : `FREQ=MONTHLY;BYMONTHDAY=${String(date.getDate())};${time}`;
  return { rrule: `RRULE:${recurrence}`, startAtUnixMs, timezone, type: "rrule" };
}

export function formatScheduledTime(unixMs: number | null, language: string | undefined): string {
  if (unixMs === null) return "-";
  return new Intl.DateTimeFormat(language === "en" ? "en" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(unixMs);
}
