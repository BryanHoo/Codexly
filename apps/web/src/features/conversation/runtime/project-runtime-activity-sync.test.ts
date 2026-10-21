import { expect, test, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { getTaskActivity } from "./task-activity.js";
import type { CodexlyRuntimeClient } from "../../projects/project-queries.js";

test("restores unopened tasks without reading histories and rejects a late snapshot after a local update", () => {
  const readTask = vi.fn();
  const manager = createProjectRuntimeManager({ readTask } as unknown as CodexlyRuntimeClient);
  const baseline = manager.getTaskActivity();
  const task = {
    projectId: "p",
    taskId: "background",
    taskName: "后台任务",
    status: "running" as const,
    requiresApproval: false,
  };
  manager.reconcileTaskActivities([task], baseline);
  expect(getTaskActivity(manager.getTaskActivity(), "p", "background").isRunning).toBe(true);
  const beforeRead = manager.getTaskActivity();
  manager.markTaskRunning("p", "other");
  manager.reconcileTaskActivities([{ ...task, taskId: "other", status: "completed" }], beforeRead);
  expect(getTaskActivity(manager.getTaskActivity(), "p", "other").isRunning).toBe(true);
  expect(readTask).not.toHaveBeenCalled();
  manager.dispose();
});

test("activity checkpoints protect status from older detail reads and repeated snapshots keep reference identity", async () => {
  const { createSnapshotResponse } = await import("./project-runtime.test-support.js");
  const manager = createProjectRuntimeManager({
    subscribeEvents: () => vi.fn(),
  } as unknown as CodexlyRuntimeClient);
  const activity = {
    projectId: "project-1",
    taskId: "background",
    taskName: "后台任务",
    status: "running" as const,
    requiresApproval: false,
    checkpoint: { sessionId: "runtime-1", sequence: 10 },
  };
  manager.reconcileTaskActivities([activity], manager.getTaskActivity());
  const current = manager.getTaskActivity();
  manager.reconcileTaskActivities([activity], current);
  expect(manager.getTaskActivity()).toBe(current);
  manager.observeSnapshot(createSnapshotResponse("background", { status: "idle", sequence: 9 }));
  expect(getTaskActivity(manager.getTaskActivity(), "project-1", "background").isRunning).toBe(
    true,
  );
  manager.dispose();
});
