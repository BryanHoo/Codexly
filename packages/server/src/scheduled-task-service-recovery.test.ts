import type { ScheduledTaskInput } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryScheduledTaskRepository,
  ScheduledTaskService,
} from "./scheduled-task-service.js";
import { turnOptions } from "./app.test-support.js";

afterEach(() => vi.useRealTimers());
const input: ScheduledTaskInput = {
  enabled: true,
  messageAttachments: [],
  name: "Retry",
  projectId: "temporary",
  projectName: "Temporary",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  schedule: { atUnixMs: 2_000, type: "once" },
  turnOptions,
};

describe("scheduled task persistence recovery", () => {
  it("blocks a new launch when the previous launch outcome is unknown after restart", async () => {
    const repository = createMemoryScheduledTaskRepository();
    const first = new ScheduledTaskService({
      repository,
      startTask: () => new Promise(() => undefined),
    });
    await first.start();
    const task = await first.create({ ...input, enabled: false });
    await first.runNow(task.id);
    // 持久运行标记模拟进程退出后的磁盘状态，替代实例不得重新投递。
    const startTask = vi.fn(() => Promise.resolve("duplicate"));
    const recovered = new ScheduledTaskService({ repository, startTask });
    await recovered.start();
    try {
      await expect(recovered.runNow(task.id)).rejects.toThrow();
      expect(startTask).not.toHaveBeenCalled();
      expect((await recovered.list())[0]?.lastRunStatus).toBe("unknown");
    } finally {
      await recovered.close();
      // 初始实例只有未决 Promise，无活动句柄；禁用它的未引用调度计时器。
      void first.close();
    }
  });
  it.each(["claim", "completion"])(
    "retries a failed automatic %s write without relaunching",
    async (phase) => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const repository = createMemoryScheduledTaskRepository();
      const replace = repository.replaceScheduledTasks.bind(repository);
      const startTask = vi.fn(() => Promise.resolve("task-a"));
      const service = new ScheduledTaskService({ repository, startTask });
      await service.start();
      await service.create(input);
      let failed = false;
      vi.spyOn(repository, "replaceScheduledTasks").mockImplementation((tasks) => {
        const status = tasks[0]?.lastRunStatus;
        if (!failed && status === (phase === "claim" ? "running" : "started")) {
          failed = true;
          return Promise.reject(new Error("disk failure"));
        }
        return replace(tasks);
      });
      try {
        await vi.advanceTimersByTimeAsync(5_000);
        expect(startTask).toHaveBeenCalledOnce();
        expect((await service.list())[0]?.lastRunStatus).toBe("started");
        expect((await repository.listScheduledTasks())[0]?.runs[0]?.taskId).toBe("task-a");
      } finally {
        await service.close();
      }
    },
  );
});
