import type { ScheduledTaskSchedule } from "@codexly/protocol";
import { wallTimeToUnix, zonedDateTime } from "@codexly/protocol";
import { restoreRecurrence } from "./scheduled-task-recurrence-parser.js";

import {
  SCHEDULE_WEEKDAYS,
  type ScheduleDraft,
  type ScheduleFrequency,
} from "./scheduled-task-draft.js";
export {
  SCHEDULE_FREQUENCIES,
  SCHEDULE_WEEKDAYS,
  type ScheduleDraft,
  type ScheduleFrequency,
  type ScheduleWeekday,
  type SchedulePreset,
} from "./scheduled-task-draft.js";

export function resolveScheduledTaskLocale(language: string | undefined): "en" | "zh-CN" {
  return language === "en" ? "en" : "zh-CN";
}

export function toLocalDateTimeInput(unixMs: number): string {
  const date = new Date(unixMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultScheduleDraft(now = Date.now()): ScheduleDraft {
  const dateTime = toLocalDateTimeInput(now + 3_600_000);
  const date = new Date(dateTime);
  const weekday = SCHEDULE_WEEKDAYS[(date.getDay() + 6) % 7] ?? "MO";
  return {
    dateTime,
    preset: "once",
    frequency: "WEEKLY",
    interval: 1,
    time: dateTime.slice(11),
    startDate: dateTime.slice(0, 10),
    weekdays: [weekday],
    monthMode: "date",
    monthDays: [date.getDate()],
    ordinals: [1],
    monthWeekday: weekday,
    yearMonth: date.getMonth() + 1,
    yearDay: date.getDate(),
    endMode: "never",
    endDate: dateTime.slice(0, 10),
    count: 10,
  };
}

export function scheduleToDraft(schedule: ScheduledTaskSchedule): ScheduleDraft {
  if (schedule.type === "once") return defaultScheduleDraft(schedule.atUnixMs - 3_600_000);
  const wall = zonedDateTime(schedule.startAtUnixMs, schedule.timezone);
  const calendar = new Date(`${wall.slice(0, 10)}T12:00:00Z`);
  const weekday = SCHEDULE_WEEKDAYS[(calendar.getUTCDay() + 6) % 7] ?? "MO";
  const base: ScheduleDraft = {
    ...defaultScheduleDraft(schedule.startAtUnixMs - 3_600_000),
    dateTime: wall.slice(0, 16),
    startDate: wall.slice(0, 10),
    time: wall.slice(11, 16),
    weekdays: [weekday],
    monthWeekday: weekday,
    monthDays: [calendar.getUTCDate()],
    yearMonth: calendar.getUTCMonth() + 1,
    yearDay: calendar.getUTCDate(),
  };
  return restoreRecurrence(schedule, base);
}

export function scheduleFrequency(draft: ScheduleDraft): ScheduleFrequency {
  if (draft.preset === "daily") return "DAILY";
  if (draft.preset === "weekly" || draft.preset === "weekdays" || draft.preset === "weekends")
    return "WEEKLY";
  if (draft.preset === "monthly") return "MONTHLY";
  return draft.frequency;
}

function integer(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function scheduleDraftError(draft: ScheduleDraft): string | undefined {
  if (draft.unsupported) return "unsupportedRule";
  if (draft.preset === "once") {
    const unixMs = new Date(draft.dateTime).getTime();
    // Date 会自动归一化不存在的日期和夏令时时间，回读必须与输入完全相同。
    return Number.isFinite(unixMs) && toLocalDateTimeInput(unixMs) === draft.dateTime
      ? undefined
      : "invalidDate";
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(draft.time)) return "invalidTime";
  if (draft.preset === "custom" && !integer(draft.interval, 1, 999)) return "invalidInterval";
  if (wallTimeToUnix(`${draft.startDate}T00:00`, "UTC") === undefined) return "invalidDate";
  const frequency = scheduleFrequency(draft);
  if (
    frequency === "WEEKLY" &&
    draft.preset !== "weekdays" &&
    draft.preset !== "weekends" &&
    (!draft.weekdays.length || draft.weekdays.some((day) => !SCHEDULE_WEEKDAYS.includes(day)))
  )
    return "selectWeekday";
  if (frequency === "MONTHLY") {
    if (
      draft.monthMode === "date" &&
      (!draft.monthDays.length || draft.monthDays.some((day) => day !== -1 && !integer(day, 1, 31)))
    )
      return "selectMonthDay";
    if (
      draft.monthMode === "weekday" &&
      (!draft.ordinals.length ||
        draft.ordinals.some((n) => n !== -1 && !integer(n, 1, 5)) ||
        !SCHEDULE_WEEKDAYS.includes(draft.monthWeekday))
    )
      return "selectOrdinal";
  }
  if (
    frequency === "YEARLY" &&
    (!integer(draft.yearMonth, 1, 12) ||
      !integer(draft.yearDay, 1, new Date(2000, draft.yearMonth, 0).getDate()))
  )
    return "invalidYearDay";
  if (draft.endMode === "count" && !integer(draft.count, 1, 10_000)) return "invalidCount";
  if (
    draft.endMode === "date" &&
    (wallTimeToUnix(`${draft.endDate}T23:59:59`, "UTC") === undefined ||
      draft.endDate < draft.startDate)
  )
    return "invalidEndDate";
  return undefined;
}

export function draftToSchedule(
  draft: ScheduleDraft,
  timezone: string,
  now = Date.now(),
): ScheduledTaskSchedule | undefined {
  if (scheduleDraftError(draft)) return undefined;
  if (draft.preset === "once") {
    const atUnixMs = new Date(draft.dateTime).getTime();
    return atUnixMs > now ? { type: "once", atUnixMs } : undefined;
  }
  const startAtUnixMs =
    draft.anchor?.startDate === draft.startDate && draft.anchor.time === draft.time
      ? draft.anchor.unixMs
      : wallTimeToUnix(`${draft.startDate}T${draft.time}`, timezone);
  if (startAtUnixMs === undefined) return undefined;
  const frequency = scheduleFrequency(draft);
  const fields = [`FREQ=${frequency}`];
  if (draft.preset === "custom" && draft.interval > 1)
    fields.push(`INTERVAL=${String(draft.interval)}`);
  if (frequency === "WEEKLY") {
    // 固定预设直接确定执行日，不受此前自定义星期选择影响。
    const days =
      draft.preset === "weekdays"
        ? SCHEDULE_WEEKDAYS.slice(0, 5)
        : draft.preset === "weekends"
          ? SCHEDULE_WEEKDAYS.slice(5)
          : SCHEDULE_WEEKDAYS.filter((day) => draft.weekdays.includes(day));
    fields.push("WKST=MO", `BYDAY=${days.join(",")}`);
  }
  if (frequency === "MONTHLY")
    fields.push(
      draft.monthMode === "date"
        ? `BYMONTHDAY=${[...new Set(draft.monthDays)].join(",")}`
        : `BYDAY=${[...new Set(draft.ordinals)].map((n) => `${String(n)}${draft.monthWeekday}`).join(",")}`,
    );
  if (frequency === "YEARLY")
    fields.push(`BYMONTH=${String(draft.yearMonth)}`, `BYMONTHDAY=${String(draft.yearDay)}`);
  const [hour, minute] = draft.time.split(":").map(Number);
  if (frequency !== "HOURLY") fields.push(`BYHOUR=${String(hour)}`);
  fields.push(`BYMINUTE=${String(minute)}`, "BYSECOND=0");
  if (draft.endMode === "count") fields.push(`COUNT=${String(draft.count)}`);
  if (draft.endMode === "date") {
    const until = wallTimeToUnix(`${draft.endDate}T23:59:59`, timezone);
    if (until === undefined || until < startAtUnixMs) return undefined;
    fields.push(`UNTIL=${new Date(until).toISOString().replace(/[-:]/gu, "").replace(".000", "")}`);
  }
  return { type: "rrule", rrule: `RRULE:${fields.join(";")}`, startAtUnixMs, timezone };
}

export function formatScheduledTime(unixMs: number | null, language: string | undefined): string {
  if (unixMs === null) return "-";
  return new Intl.DateTimeFormat(resolveScheduledTaskLocale(language), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(unixMs);
}
