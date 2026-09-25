import { describe, expect, it } from "vitest";
import { defaultScheduleDraft, draftToSchedule, scheduleToDraft, formatScheduledTime } from "./scheduled-task-schedule.js";

const now = Date.UTC(2030, 0, 1);
const draft = () => ({ ...defaultScheduleDraft(now), startDate: "2030-01-02", time: "09:15" });

describe("visual recurrence", () => {
  it("builds and restores weekends independently of custom weekday selections", () => {
    const schedule = draftToSchedule({ ...draft(), preset: "weekends", weekdays: [], endMode: "count", count: 6 }, "Asia/Shanghai", now)!;
    expect(schedule).toMatchObject({ rrule: "RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=SA,SU;BYHOUR=9;BYMINUTE=15;BYSECOND=0;COUNT=6" });
    expect(scheduleToDraft(schedule)).toMatchObject({ preset: "weekends", weekdays: ["SA", "SU"], count: 6 });
    expect(draftToSchedule(scheduleToDraft(schedule), "Asia/Shanghai", now)).toEqual(schedule);
  });
  it("builds anchored biweekly rules with multiple weekdays and a finite count", () => {
    expect(draftToSchedule({ ...draft(), preset: "custom", frequency: "WEEKLY", interval: 2,
      weekdays: ["MO", "WE", "FR"], endMode: "count", count: 6 }, "Asia/Shanghai", now)).toEqual({
      type: "rrule", timezone: "Asia/Shanghai", startAtUnixMs: Date.UTC(2030, 0, 2, 1, 15),
      rrule: "RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=15;BYSECOND=0;COUNT=6",
    });
  });
  it("round trips monthly ordinals, month end, hourly and yearly schedules", () => {
    const variants = [
      { ...draft(), preset: "monthly" as const, monthDays: [1, 15, -1] },
      { ...draft(), preset: "custom" as const, frequency: "MONTHLY" as const, interval: 2,
        monthMode: "weekday" as const, ordinals: [2, 4], monthWeekday: "WE" as const },
      { ...draft(), preset: "custom" as const, frequency: "HOURLY" as const, interval: 4 },
      { ...draft(), preset: "custom" as const, frequency: "YEARLY" as const, yearMonth: 6, yearDay: 1 },
    ];
    for (const value of variants) {
      const schedule = draftToSchedule(value, "America/New_York", now)!;
      expect(schedule).toBeDefined();
      expect(draftToSchedule(scheduleToDraft(schedule), "America/New_York", now + 86_400_000)).toEqual(schedule);
    }
  });
  it("includes the entire end date in the task timezone", () => {
    const schedule = draftToSchedule({ ...draft(), preset: "daily", endMode: "date", endDate: "2030-01-10" }, "Asia/Shanghai", now);
    expect(schedule).toMatchObject({ rrule: expect.stringContaining("UNTIL=20300110T155959Z") });
    expect(scheduleToDraft(schedule!)).toMatchObject({ endMode: "date", endDate: "2030-01-10" });
  });
  it("restores saved anchors and wall time even when the computer timezone differs", () => {
    const schedule = { type: "rrule" as const, timezone: "America/New_York", startAtUnixMs: Date.UTC(2030, 0, 2, 14, 15),
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=15" };
    const restored = scheduleToDraft(schedule);
    expect(restored).toMatchObject({ preset: "weekly", weekdays: ["MO", "FR"], startDate: "2030-01-02", time: "09:15" });
    expect(draftToSchedule(restored, schedule.timezone, now + 999999999)).toMatchObject({ startAtUnixMs: schedule.startAtUnixMs });
  });
  it("rejects incomplete fields and backwards endings", () => {
    for (const value of [
      { ...draft(), preset: "weekly" as const, weekdays: [] },
      { ...draft(), preset: "monthly" as const, monthDays: [] },
      { ...draft(), preset: "custom" as const, interval: 0 },
      { ...draft(), preset: "custom" as const, interval: 1.5 },
      { ...draft(), preset: "daily" as const, time: "25:00" },
      { ...draft(), preset: "daily" as const, startDate: "2030-02-30" },
      { ...draft(), preset: "daily" as const, endMode: "date" as const, endDate: "2030-01-01" },
      { ...draft(), preset: "daily" as const, endMode: "count" as const, count: 0 },
      { ...draft(), preset: "custom" as const, frequency: "YEARLY" as const, yearMonth: 2, yearDay: 30 },
    ]) expect(draftToSchedule(value, "UTC", now)).toBeUndefined();
  });
  it("rejects nonexistent DST wall times instead of shifting them silently", () => {
    expect(draftToSchedule({ ...draft(), preset: "daily", startDate: "2030-03-10", time: "02:30" }, "America/New_York", now)).toBeUndefined();
  });
  it("keeps unsupported constraints from being silently overwritten", () => {
    for (const rrule of ["FREQ=DAILY;BYSETPOS=1", "FREQ=DAILY;BYDAY=MO", "FREQ=HOURLY;BYHOUR=9,17", "FREQ=MONTHLY;BYDAY=2WE,4FR"]) {
      const restored = scheduleToDraft({ type: "rrule", timezone: "UTC", startAtUnixMs: now, rrule });
      expect(restored.unsupported).toBe(true);
      expect(draftToSchedule(restored, "UTC", now)).toBeUndefined();
    }
  });
  it("formats dates using the application language", () => {
    for (const language of ["en", "zh-CN"]) expect(formatScheduledTime(now, language)).toBe(
      new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(now),
    );
  });
});
