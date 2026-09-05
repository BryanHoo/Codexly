import { describe, expect, it } from "vitest";

import {
  draftToSchedule,
  formatScheduledTime,
  scheduleToDraft,
} from "./scheduled-task-schedule.js";

describe("scheduled task schedule", () => {
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
