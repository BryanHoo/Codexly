import { describe, expect, it } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

describe("scheduled task preview endpoint", () => {
  it("keeps other HTTP requests responsive while a recurrence times out", async () => {
    const { provider } = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider));
    closeCallbacks.push(() => app.close());
    let finished = false;
    const pending = app
      .inject({
        method: "POST",
        url: "/v1/scheduled-tasks/preview",
        payload: {
          schedule: {
            type: "rrule",
            timezone: "UTC",
            startAtUnixMs: Date.UTC(2030, 0, 1),
            rrule: "FREQ=MINUTELY;BYMONTH=2;BYMONTHDAY=30",
          },
        },
      })
      .then((response) => {
        finished = true;
        return response;
      });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    const other = await app.inject({ method: "GET", url: "/v1/scheduled-tasks" });
    expect(other.statusCode).toBe(200);
    expect(finished).toBe(false);
    const response = await pending;
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("timed out");
  });
  it("previews at most five occurrences without creating a task", async () => {
    const { provider } = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider));
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/v1/scheduled-tasks/preview",
      payload: {
        schedule: {
          type: "rrule",
          timezone: "Asia/Shanghai",
          startAtUnixMs: Date.UTC(2030, 0, 1, 1, 15),
          rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=15;BYSECOND=0;COUNT=6",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      dates: [1, 2, 3, 4, 5].map((day) => Date.UTC(2030, 0, day, 1, 15)),
    });
    expect((await app.inject({ method: "GET", url: "/v1/scheduled-tasks" })).json()).toEqual({
      data: [],
    });
  });

  it("distinguishes exhausted schedules from invalid rules", async () => {
    const { provider } = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider));
    closeCallbacks.push(() => app.close());
    const schedule = {
      type: "rrule",
      timezone: "UTC",
      startAtUnixMs: Date.UTC(2000, 0, 1),
      rrule: "FREQ=DAILY;COUNT=1",
    };
    const post = (value: unknown) =>
      app.inject({
        method: "POST",
        url: "/v1/scheduled-tasks/preview",
        payload: { schedule: value },
      });
    expect((await post(schedule)).json()).toEqual({ dates: [] });
    expect((await post({ ...schedule, rrule: "invalid" })).statusCode).toBe(400);
    expect((await post({ ...schedule, timezone: "invalid" })).statusCode).toBe(400);
    expect((await post({ ...schedule, rrule: "FREQ=SECONDLY" })).statusCode).toBe(400);
  });
});
