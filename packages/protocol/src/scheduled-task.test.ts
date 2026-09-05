import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { ScheduledTaskSchema } from "./scheduled-task.js";

describe("ScheduledTaskSchema", () => {
  it("accepts scheduled task snapshots and rejects removed cron schedules", () => {
    const task = {
      createdAtUnixMs: 1,
      enabled: true,
      id: "schedule-a",
      lastRunAtUnixMs: null,
      lastRunStatus: null,
      messageAttachments: [],
      name: "Daily review",
      nextRunAtUnixMs: 2_000_000_000_000,
      projectId: "temporary",
      projectName: "Temporary task",
      prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
      runs: [],
      schedule: {
        rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
        startAtUnixMs: 2_000_000_000_000,
        timezone: "Asia/Shanghai",
        type: "rrule",
      },
      turnOptions: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      updatedAtUnixMs: 1,
    };

    expect(Value.Check(ScheduledTaskSchema, task)).toBe(true);
    expect(
      Value.Check(ScheduledTaskSchema, {
        ...task,
        schedule: {
          expression: "0 9 * * 1-5",
          startAtUnixMs: 2_000_000_000_000,
          timezone: "Asia/Shanghai",
          type: "cron",
        },
      }),
    ).toBe(false);
  });
});
