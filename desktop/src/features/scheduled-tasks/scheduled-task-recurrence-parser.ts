import type { ScheduledTaskSchedule } from "@/protocol/index.js";
import { SCHEDULE_FREQUENCIES, SCHEDULE_WEEKDAYS, type ScheduleDraft, type ScheduleFrequency, type ScheduleWeekday } from "./scheduled-task-schedule.js";
import { zonedDateTime } from "./scheduled-task-wall-time.js";

const supported = new Set(["FREQ", "INTERVAL", "WKST", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYHOUR", "BYMINUTE", "BYSECOND", "COUNT", "UNTIL"]);

export function restoreRecurrence(schedule: Extract<ScheduledTaskSchedule, { type: "rrule" }>, base: ScheduleDraft): ScheduleDraft {
  const entries = schedule.rrule.trim().replace(/^RRULE:/u, "").split(";").map((part) => part.split("="));
  const fields = new Map(entries.map(([key, value]) => [key!, value!]));
  const frequency = fields.get("FREQ") as ScheduleFrequency;
  const unsupported = () => ({ ...base, preset: "custom" as const, unsupported: true });
  // 只还原可完整表达的规则；不可表达的规则必须由用户重新设置，不能静默删掉约束。
  if (entries.some((entry) => entry.length !== 2 || !supported.has(entry[0]!) || !entry[1]) || fields.size !== entries.length ||
      !SCHEDULE_FREQUENCIES.includes(frequency) || (fields.has("WKST") && fields.get("WKST") !== "MO") ||
      (fields.has("BYSECOND") && fields.get("BYSECOND") !== "0") ||
      (!fields.has("BYSECOND") && schedule.startAtUnixMs % 60_000 !== 0)) return unsupported();
  const hour = fields.get("BYHOUR") ?? base.time.slice(0, 2);
  const minute = fields.get("BYMINUTE") ?? base.time.slice(3);
  if (!/^\d{1,2}$/u.test(hour) || !/^\d{1,2}$/u.test(minute) || (frequency === "HOURLY" && fields.has("BYHOUR"))) return unsupported();
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  const interval = Number(fields.get("INTERVAL") ?? 1);
  let result: ScheduleDraft = { ...base, preset: "custom", frequency, interval, time,
    anchor: { unixMs: schedule.startAtUnixMs, startDate: base.startDate, time } };
  const byDay = fields.get("BYDAY");
  if (frequency === "WEEKLY") {
    const weekdays = byDay?.split(",") ?? base.weekdays;
    if (weekdays.some((day) => !SCHEDULE_WEEKDAYS.includes(day as ScheduleWeekday))) return unsupported();
    result = { ...result, weekdays: weekdays as ScheduleWeekday[] };
  } else if (frequency === "MONTHLY" && byDay) {
    const days = byDay.split(",").map((day) => /^(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)$/u.exec(day));
    if (days.some((day) => day === null || day[2] !== days[0]?.[2]) || fields.has("BYMONTHDAY")) return unsupported();
    result = { ...result, monthMode: "weekday", ordinals: days.map((day) => Number(day![1])), monthWeekday: days[0]![2] as ScheduleWeekday };
  } else if (byDay) return unsupported();
  if (fields.has("BYMONTHDAY")) {
    const days = fields.get("BYMONTHDAY")!.split(",").map(Number);
    if (frequency === "MONTHLY") result = { ...result, monthDays: days };
    else if (frequency === "YEARLY" && days.length === 1) result = { ...result, yearDay: days[0]! };
    else return unsupported();
  }
  if (fields.has("BYMONTH")) {
    if (frequency !== "YEARLY" || !/^\d{1,2}$/u.test(fields.get("BYMONTH")!)) return unsupported();
    result = { ...result, yearMonth: Number(fields.get("BYMONTH")) };
  }
  if (fields.has("COUNT") && fields.has("UNTIL")) return unsupported();
  if (fields.has("COUNT")) result = { ...result, endMode: "count", count: Number(fields.get("COUNT")) };
  if (fields.has("UNTIL")) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(fields.get("UNTIL")!);
    if (!match) return unsupported();
    const end = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    if (!Number.isFinite(end)) return unsupported();
    const wall = zonedDateTime(end, schedule.timezone);
    if (!wall.endsWith("23:59:59")) return unsupported();
    result = { ...result, endMode: "date", endDate: wall.slice(0, 10) };
  }
  if (interval === 1) {
    if (frequency === "DAILY") result = { ...result, preset: "daily" };
    if (frequency === "WEEKLY") {
      const days = SCHEDULE_WEEKDAYS.filter((day) => result.weekdays.includes(day)).join(",");
      result = { ...result, preset: days === "MO,TU,WE,TH,FR" ? "weekdays" : days === "SA,SU" ? "weekends" : "weekly" };
    }
    if (frequency === "MONTHLY") result = { ...result, preset: "monthly" };
  }
  return result;
}
