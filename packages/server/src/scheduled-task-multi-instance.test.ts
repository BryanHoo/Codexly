import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import type { ScheduledTaskInput } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { turnOptions } from "./app.test-support.js";
import { ScheduledTaskService } from "./scheduled-task-service.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const input: ScheduledTaskInput = {
  enabled: false,
  messageAttachments: [],
  name: "Shared schedule",
  projectId: "temporary",
  projectName: "Temporary",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  schedule: { atUnixMs: Date.now() + 60_000, type: "once" },
  turnOptions,
};

describe("scheduled tasks shared by Web instances", () => {
  it("releases short locks and discards run ownership when another process crashes", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const { createScheduledTaskCoordination } = await import(process.argv[1]);
      const coordination = createScheduledTaskCoordination(process.argv[2]);
      coordination.initialize(() => {});
      const operations = coordination.operations;
      operations.acquireScheduledTaskLock();
      operations.claimScheduledTaskRun({ runId: 'orphan' });
      operations.releaseScheduledTaskLock();
      operations.acquireScheduledTaskLock();
      process.stdout.write('ready');
      setInterval(() => {}, 1000);
    `,
        new URL("./sqlite-scheduled-task-coordination.js", import.meta.url).href,
        join(root, "state.sqlite3"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    try {
      await once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) });
      child.kill("SIGKILL");
      await exited;
      await repository.withScheduledTaskLock(async () => {
        expect(await repository.listActiveScheduledTaskRunIds()).toEqual([]);
      });
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  });

  it("preserves concurrent writes and does not recover or relaunch a live owner's run", async () => {
    const root = await createWorkspace();
    const [firstRepository, secondRepository] = await Promise.all([
      openRepository(root),
      openRepository(root),
    ]);
    let finish!: (taskId: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const startTask = vi.fn(() => pending);
    const first = new ScheduledTaskService({ repository: firstRepository, startTask });
    const duplicate = vi.fn(() => Promise.resolve("duplicate"));
    const second = new ScheduledTaskService({ repository: secondRepository, startTask: duplicate });
    await Promise.all([first.start(), second.start()]);
    try {
      const [task] = await Promise.all([first.create(input), second.create(input)]);
      expect(await first.list()).toHaveLength(2);
      expect(await second.list()).toHaveLength(2);
      await first.runNow(task.id);
      const thirdRepository = await openRepository(root);
      const third = new ScheduledTaskService({ repository: thirdRepository, startTask: duplicate });
      await third.start();
      try {
        expect((await third.list()).find((item) => item.id === task.id)?.lastRunStatus).toBe(
          "running",
        );
        await expect(second.runNow(task.id)).rejects.toThrow();
        await expect(third.delete(task.id)).rejects.toThrow();
        expect(startTask).toHaveBeenCalledOnce();
        expect(duplicate).not.toHaveBeenCalled();
      } finally {
        await third.close();
      }
      finish("task-a");
      await vi.waitFor(async () => {
        expect((await second.list()).find((item) => item.id === task.id)?.lastRunStatus).toBe(
          "started",
        );
      });
    } finally {
      finish("task-a");
      await Promise.all([first.close(), second.close()]);
    }
  });
});
