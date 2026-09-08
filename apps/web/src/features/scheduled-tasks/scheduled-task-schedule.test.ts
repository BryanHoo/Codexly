import { describe, expect, it } from "vitest";

import {
  defaultScheduleDraft,
  draftToSchedule,
  formatScheduledTime,
  scheduleToDraft,
} from "./scheduled-task-schedule.js";

describe("scheduled task schedule", () => {
  it.each(["daily", "weekdays", "weekly", "monthly"] as const)(
    "recognizes only the complete %s preset",
    (preset) => {
      const schedule = draftToSchedule(
        { ...defaultScheduleDraft(), preset, rrule: "", time: "09:15" },
        "UTC",
      );
      if (schedule?.type !== "rrule") throw new Error("Expected recurrence");
      expect(scheduleToDraft(schedule).preset).toBe(preset);
      expect(draftToSchedule(scheduleToDraft(schedule), "Asia/Shanghai")).toEqual(schedule);
      expect(scheduleToDraft({ ...schedule, rrule: `${schedule.rrule};COUNT=5` }).preset).toBe(
        "custom",
      );
    },
  );

  it.each([
    "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=5",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20350101T000000Z",
  ])("preserves the complete schedule when editing a name: %s", (rrule) => {
    const schedule = {
      rrule,
      startAtUnixMs: new Date("2030-01-02T09:15:23.456Z").getTime(),
      timezone: "America/New_York",
      type: "rrule" as const,
    };
    const draft = scheduleToDraft(schedule);
    expect(draft.preset).toBe("custom");
    expect(draftToSchedule(draft, "Asia/Shanghai")).toEqual(schedule);
  });

  it("builds presets and preserves custom RRULE values", () => {
    expect(
      draftToSchedule(
        { ...defaultScheduleDraft(), preset: "daily", rrule: "", time: "09:15" },
        "Asia/Shanghai",
      ),
    ).toMatchObject({
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=15",
      timezone: "Asia/Shanghai",
      type: "rrule",
    });
    const custom = {
      rrule: "RRULE:FREQ=YEARLY;BYMONTH=6",
      startAtUnixMs: 1_900_000_000_000,
      timezone: "UTC",
      type: "rrule" as const,
    };
    expect(scheduleToDraft(custom)).toMatchObject({ preset: "custom", rrule: custom.rrule });
  });

  it("uses explicit recurring fields independently of the once date", () => {
    const now = new Date(2030, 0, 2, 8).getTime();
    const draft = {
      ...defaultScheduleDraft(now),
      dateTime: "2040-12-25T23:59",
      time: "09:15",
    };

    expect(
      draftToSchedule({ ...draft, preset: "weekly", weekday: "FR" }, "Asia/Shanghai", now),
    ).toMatchObject({
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=15",
      startAtUnixMs: now,
    });
    expect(
      draftToSchedule({ ...draft, monthDay: 31, preset: "monthly" }, "Asia/Shanghai", now),
    ).toMatchObject({
      rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9;BYMINUTE=15",
      startAtUnixMs: now,
    });
  });

  it("restores recurrence fields from the rule instead of its start date", () => {
    const schedule = {
      startAtUnixMs: new Date(2030, 0, 2, 8).getTime(),
      timezone: "Asia/Shanghai",
      type: "rrule" as const,
    };

    expect(
      scheduleToDraft({
        ...schedule,
        rrule: "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=45",
      }),
    ).toMatchObject({ preset: "weekly", time: "17:45", weekday: "FR" });
    expect(
      scheduleToDraft({
        ...schedule,
        rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9;BYMINUTE=5",
      }),
    ).toMatchObject({ monthDay: 31, preset: "monthly", time: "09:05" });
  });

  it("rejects incomplete or invalid recurring fields", () => {
    const draft = { ...defaultScheduleDraft(), preset: "monthly" as const };

    for (const monthDay of [0, 32, 1.5, Number.NaN]) {
      expect(draftToSchedule({ ...draft, monthDay }, "UTC")).toBeUndefined();
    }
    for (const time of ["", "25:00", "09:60"]) {
      expect(draftToSchedule({ ...draft, time }, "UTC")).toBeUndefined();
    }
  });

  it("formats scheduled times with the app language", () => {
    const unixMs = new Date(2030, 0, 2, 9, 15).getTime();
    expect(formatScheduledTime(unixMs, "en")).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(unixMs),
    );
  });
});
