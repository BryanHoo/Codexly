import type { ScheduledTask, ScheduledTaskInput } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import {
  claimScheduledTasks,
  completeScheduledTaskRun,
  createScheduledTask,
  repairInterruptedScheduledTasks,
} from "./scheduled-task-runtime.js";

const input: ScheduledTaskInput = {
  enabled: true,
  messageAttachments: [],
  name: "Daily review",
  projectId: "project-a",
  projectName: "Project A",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  schedule: { atUnixMs: 2_000, type: "once" },
  turnOptions: {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
};

describe("scheduled task runtime", () => {
  it("rejects an empty normalized name", () => {
    expect(() => createScheduledTask("schedule-empty", { ...input, name: "   " }, 1_000)).toThrow(
      "must not be empty",
    );
  });

  it("claims a due one-time task and completes its run", () => {
    const task = createScheduledTask("schedule-a", input, 1_000);
    const { claims, tasks } = claimScheduledTasks([task], new Set(), 2_000);

    expect(claims).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      enabled: false,
      lastRunStatus: "running",
      nextRunAtUnixMs: null,
    });
    const claim = claims[0];
    if (claim === undefined) throw new Error("Expected a scheduled task claim");
    const completed = completeScheduledTaskRun(tasks, claim, 2_100, {
      status: "fulfilled",
      value: "task-a",
    });
    expect(completed[0]?.runs[0]).toMatchObject({ status: "started", taskId: "task-a" });
  });

  it("records skipped overlap and repairs interrupted runs", () => {
    const scheduledAt = 1_709_971_200_000;
    const recurring: ScheduledTask = {
      ...createScheduledTask(
        "schedule-b",
        {
          ...input,
          schedule: {
            rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            startAtUnixMs: scheduledAt,
            timezone: "America/New_York",
            type: "rrule",
          },
        },
        1_700_000_000_000,
      ),
      nextRunAtUnixMs: scheduledAt,
    };
    const skipped = claimScheduledTasks([recurring], new Set([recurring.id]), scheduledAt).tasks;
    const skippedTask = skipped[0];
    if (skippedTask === undefined) throw new Error("Expected a skipped scheduled task");
    expect(skippedTask.lastRunStatus).toBe("skipped");
    expect(skippedTask.nextRunAtUnixMs).toBeGreaterThan(scheduledAt);
    const skippedRun = skippedTask.runs[0];
    if (skippedRun === undefined) throw new Error("Expected a skipped run record");

    const repaired = repairInterruptedScheduledTasks(
      [
        {
          ...skippedTask,
          lastRunStatus: "running",
          runs: [{ ...skippedRun, status: "running", finishedAtUnixMs: null }],
        },
      ],
      1_800_000_000_000,
    );
    expect(repaired[0]?.runs[0]).toMatchObject({
      status: "failed",
      finishedAtUnixMs: 1_800_000_000_000,
    });
  });
});
