import { describe, expect, it } from "vitest";
import {
  defaultScheduleDraft,
  draftToSchedule,
  scheduleToDraft,
} from "./scheduled-task-schedule.js";

describe("scheduled task date and time", () => {
  const now = new Date(2030, 0, 2, 8).getTime();

  it("starts one hour ahead with minute precision", () => {
    const draft = defaultScheduleDraft(now + 12_345);
    expect(draft.dateTime).toBe("2030-01-02T09:00");
    const schedule = draftToSchedule(draft, "UTC", now);
    expect(schedule).toEqual({ type: "once", atUnixMs: new Date(2030, 0, 2, 9).getTime() });
    if (schedule === undefined) throw new Error("Expected schedule");
    expect(scheduleToDraft(schedule)).toEqual(draft);
  });

  it("rejects empty, impossible and past one-time dates", () => {
    for (const dateTime of ["", "invalid", "2030-02-30T09:00", "2030-01-01T09:00"])
      expect(
        draftToSchedule({ ...defaultScheduleDraft(now), dateTime }, "UTC", now),
      ).toBeUndefined();
  });

  it("keeps recurring fields independent of the one-time date", () => {
    const draft = {
      ...defaultScheduleDraft(now),
      dateTime: "2040-12-25T23:59",
      startDate: "2030-01-02",
      time: "09:15",
    };
    expect(
      draftToSchedule({ ...draft, preset: "weekly", weekdays: ["FR"] }, "Asia/Shanghai", now),
    ).toMatchObject({
      rrule: "RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=FR;BYHOUR=9;BYMINUTE=15;BYSECOND=0",
      startAtUnixMs: Date.UTC(2030, 0, 2, 1, 15),
    });
  });
});
