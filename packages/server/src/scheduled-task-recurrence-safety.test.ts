import { expect, it } from "vitest";
import { previewScheduledTask } from "./scheduled-task-recurrence.js";

const after = Date.UTC(2029, 0, 1);
const schedule = (rrule: string) => ({
  type: "rrule" as const,
  rrule,
  timezone: "UTC",
  startAtUnixMs: Date.UTC(2030, 0, 1),
});

it.each([
  ["FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=30", "at least one minute"],
  ["FREQ=DAILY;" + "BYDAY=MO;".repeat(200), "too complex"],
  [
    "FREQ=DAILY;BYHOUR=1,2,3,4,5,6;BYMINUTE=1,2,3,4,5,6;BYSECOND=" +
      Array.from({ length: 60 }, (_, i) => i).join(","),
    "too complex",
  ],
])("rejects unsafe complexity before starting computation: %s", async (rrule, error) => {
  await expect(previewScheduledTask(schedule(rrule), after)).rejects.toThrow(error);
});

it("terminates expensive searches without blocking timers and recovers capacity", async () => {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 20);
  try {
    // 有效的分钟级规则仍可能永远没有匹配，必须由线程外的预算中断。
    await expect(
      previewScheduledTask(schedule("FREQ=MINUTELY;BYMONTH=2;BYMONTHDAY=30"), after),
    ).rejects.toThrow("timed out");
    expect(ticks).toBeGreaterThan(0);
    expect(await previewScheduledTask(schedule("FREQ=DAILY;COUNT=2"), after)).toHaveLength(2);
  } finally {
    clearInterval(timer);
  }
});

it("bounds concurrent workers and releases slots after timeouts", async () => {
  const pending = Array.from({ length: 4 }, () =>
    previewScheduledTask(schedule("FREQ=MINUTELY;BYMONTH=2;BYMONTHDAY=30"), after),
  );
  const completed = Promise.allSettled(pending);
  await expect(previewScheduledTask(schedule("FREQ=DAILY"), after)).rejects.toThrow("busy");
  expect((await completed).every((result) => result.status === "rejected")).toBe(true);
  expect(await previewScheduledTask(schedule("FREQ=DAILY;COUNT=2"), after)).toHaveLength(2);
});

it("returns recurrence work asynchronously so the request thread stays available", async () => {
  const result = previewScheduledTask(
    {
      type: "rrule",
      rrule: "FREQ=DAILY;COUNT=2",
      timezone: "UTC",
      startAtUnixMs: Date.UTC(2030, 0, 1),
    },
    Date.UTC(2029, 0, 1),
  );
  expect(result).toBeInstanceOf(Promise);
  expect(await result).toHaveLength(2);
});
