import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { ScheduledTaskSchema } from "./scheduled-task.js";

describe("ScheduledTaskSchema", () => {
  it("accepts the camelCase Rust response contract", () => {
    expect(
      Value.Check(ScheduledTaskSchema, {
        createdAtUnixMs: 1,
        enabled: true,
        id: "schedule-a",
        lastRunAtUnixMs: null,
        lastRunStatus: null,
        name: "Daily review",
        nextRunAtUnixMs: 2_000_000_000_000,
        projectId: "temporary",
        projectName: "Temporary task",
        prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
        runs: [],
        schedule: { atUnixMs: 2_000_000_000_000, type: "once" },
        turnOptions: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        updatedAtUnixMs: 1,
      }),
    ).toBe(true);
  });

  it("accepts custom RRULE and rejects the removed Cron contract", () => {
    const rrule = {
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
      startAtUnixMs: 2_000_000_000_000,
      timezone: "Asia/Shanghai",
      type: "rrule",
    };
    const cron = {
      expression: "0 9 * * 1-5",
      startAtUnixMs: 2_000_000_000_000,
      timezone: "Asia/Shanghai",
      type: "cron",
    };

    expect(Value.Check(ScheduledTaskSchema.properties.schedule, rrule)).toBe(true);
    expect(Value.Check(ScheduledTaskSchema.properties.schedule, cron)).toBe(false);
  });
});
