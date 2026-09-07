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
