import { afterEach, describe, expect, it, vi } from "vitest";
import { turnOptions } from "./app.test-support.js";

import {
  ScheduledTaskService,
  createMemoryScheduledTaskRepository,
} from "./scheduled-task-service.js";

afterEach(() => vi.useRealTimers());

describe("ScheduledTaskService", () => {
  it("allows retry after the manual claim cannot be persisted", async () => {
    const repository = createMemoryScheduledTaskRepository();
    const startTask = vi.fn(() => Promise.resolve("task-a"));
    const service = new ScheduledTaskService({ repository, startTask });
    await service.start();
    const task = await service.create({
      enabled: false,
      messageAttachments: [],
      name: "Retry",
      projectId: "temporary",
      projectName: "Temporary",
      prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
      schedule: { atUnixMs: Date.now() + 60_000, type: "once" },
      turnOptions,
    });
    vi.spyOn(repository, "replaceScheduledTasks").mockRejectedValueOnce(new Error("disk failure"));
    try {
      await expect(service.runNow(task.id)).rejects.toThrow("disk failure");
      expect(startTask).not.toHaveBeenCalled();
      await expect(service.runNow(task.id)).resolves.toMatchObject({ id: task.id });
    } finally {
      await service.close();
    }
    expect(startTask).toHaveBeenCalledOnce();
  });

  it("starts a due task from the nearest-deadline timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const startTask = vi.fn(() => Promise.resolve("task-a"));
    const service = new ScheduledTaskService({
      repository: createMemoryScheduledTaskRepository(),
      startTask,
    });
    await service.start();
    const changed = vi.fn();
    const unsubscribe = service.subscribe(changed);
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
    // 创建、到期领取、启动结果落库均主动通知，无需浏览器轮询。
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    if (task === undefined) throw new Error("Expected scheduled task");
    await service.setEnabled(task.id, false);
    expect(changed).toHaveBeenCalledTimes(3);
    await service.close();
  });
});
