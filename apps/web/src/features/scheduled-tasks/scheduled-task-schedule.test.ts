import { describe, expect, it } from "vitest";

import {
  draftToSchedule,
  formatScheduledTime,
  scheduleToDraft,
} from "./scheduled-task-schedule.js";

describe("scheduled task schedule", () => {
  it.each(["daily", "weekdays", "weekly", "monthly"] as const)(
    "recognizes only the complete %s preset",
    (preset) => {
      const schedule = draftToSchedule({ dateTime: "2030-01-02T09:15", preset, rrule: "" }, "UTC");
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
        { dateTime: "2030-01-02T09:15", preset: "daily", rrule: "" },
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

  it("formats scheduled times with the app language", () => {
    const unixMs = new Date(2030, 0, 2, 9, 15).getTime();
    expect(formatScheduledTime(unixMs, "en")).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(unixMs),
    );
  });
});
