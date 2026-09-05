import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ScheduledTaskService,
  createMemoryScheduledTaskRepository,
} from "./scheduled-task-service.js";

afterEach(() => vi.useRealTimers());

describe("ScheduledTaskService", () => {
  it("starts a due task from the nearest-deadline timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const startTask = vi.fn(() => Promise.resolve("task-a"));
    const service = new ScheduledTaskService({
      repository: createMemoryScheduledTaskRepository(),
      startTask,
    });
    await service.start();
    await service.create({
      enabled: true,
      messageAttachments: [],
      name: "One time",
      projectId: "temporary",
      projectName: "Temporary",
      prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
      schedule: { atUnixMs: 2_000, type: "once" },
      turnOptions: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(startTask).toHaveBeenCalledOnce();
    });
    const [task] = await service.list();
    expect(task).toMatchObject({ enabled: false, lastRunStatus: "started" });
    expect(task?.runs[0]).toMatchObject({ status: "started", taskId: "task-a" });
    await service.close();
  });
});
