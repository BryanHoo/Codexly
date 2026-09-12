import { describe, expect, it } from "vitest";
import type { ScheduledTaskSchedule } from "@codexly/protocol";
import { previewScheduledTask } from "./scheduled-task-recurrence.js";
import { resolveNextScheduledRun } from "./scheduled-task-runtime.js";

function recurring(
  rrule: string,
  timezone = "America/New_York",
  startAtUnixMs = Date.UTC(2030, 2, 8, 14, 15),
): ScheduledTaskSchedule {
  return { type: "rrule", rrule, timezone, startAtUnixMs };
}

describe("scheduled task recurrence execution", () => {
  it("seeks old hourly anchors while preserving the interval phase", async () => {
    const start = Date.UTC(1990, 0, 1, 9, 15);
    const after = Date.UTC(2030, 0, 1);
    const interval = 7 * 3_600_000;
    const next = start + Math.ceil((after + 1 - start) / interval) * interval;
    expect(
      await previewScheduledTask(
        recurring("FREQ=HOURLY;INTERVAL=7;BYMINUTE=15;BYSECOND=0", "UTC", start),
        after,
      ),
    ).toEqual(Array.from({ length: 5 }, (_, index) => next + index * interval));
  });
  it("keeps local time across DST and shares the preview with execution", async () => {
    const schedule = recurring("FREQ=DAILY;BYHOUR=9;BYMINUTE=15;BYSECOND=0;COUNT=4");
    const dates = await previewScheduledTask(schedule, Date.UTC(2030, 2, 8));
    expect(dates).toEqual([
      Date.UTC(2030, 2, 8, 14, 15),
      Date.UTC(2030, 2, 9, 14, 15),
      Date.UTC(2030, 2, 10, 13, 15),
      Date.UTC(2030, 2, 11, 13, 15),
    ]);
    expect(await resolveNextScheduledRun(schedule, Date.UTC(2030, 2, 9, 14, 15))).toBe(dates[2]);
    expect(await previewScheduledTask(schedule, Date.UTC(2030, 2, 11, 13, 15))).toEqual([]);
  });

  it("skips nonexistent wall times without consuming COUNT", async () => {
    const schedule = recurring(
      "FREQ=DAILY;BYHOUR=2;BYMINUTE=30;BYSECOND=0;COUNT=3",
      "America/New_York",
      Date.UTC(2030, 2, 9, 7, 30),
    );
    expect(await previewScheduledTask(schedule, Date.UTC(2030, 2, 9))).toEqual([
      Date.UTC(2030, 2, 9, 7, 30),
      Date.UTC(2030, 2, 11, 6, 30),
      Date.UTC(2030, 2, 12, 6, 30),
    ]);
  });

  it("includes the entire end date in the task timezone", async () => {
    const schedule = recurring(
      "FREQ=DAILY;BYHOUR=23;BYMINUTE=0;BYSECOND=0;UNTIL=20300102T155959Z",
      "Asia/Shanghai",
      Date.UTC(2030, 0, 1, 15),
    );
    expect(await previewScheduledTask(schedule, Date.UTC(2030, 0, 1))).toEqual([
      Date.UTC(2030, 0, 1, 15),
      Date.UTC(2030, 0, 2, 15),
    ]);
  });

  it.each([
    ["FREQ=WEEKLY;WKST=MO;BYDAY=SA,SU;BYHOUR=9;BYMINUTE=15;BYSECOND=0", [5, 6, 12, 13, 19]],
    ["FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9;BYMINUTE=15;BYSECOND=0", [31]],
  ] as const)("evaluates calendar selections: %s", async (rrule, days) => {
    const dates = await previewScheduledTask(
      recurring(rrule, "UTC", Date.UTC(2030, 0, 1)),
      Date.UTC(2030, 0, 1),
    );
    expect(dates.slice(0, days.length)).toEqual(days.map((day) => Date.UTC(2030, 0, day, 9, 15)));
    expect(dates).toHaveLength(5);
  });
});
