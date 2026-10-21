import { expect, test, vi } from "vitest";
import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { getTaskActivity } from "./task-activity.js";

test("reconciles unopened native tasks and preserves newer local changes without reading history", () => {
  const readTask = vi.fn();
  const runtime = createProjectRuntimeManager({ readTask } as unknown as NativeRuntimeClient);
  const task = { projectId: "p", taskId: "t", taskName: "后台任务", status: "running" as const, requiresApproval: false };
  runtime.reconcileTaskActivities([task], runtime.getTaskActivity());
  expect(getTaskActivity(runtime.getTaskActivity(), "p", "t").isRunning).toBe(true);
  runtime.reconcileTaskActivities([{ ...task, status: "completed" }], runtime.getTaskActivity());
  expect(getTaskActivity(runtime.getTaskActivity(), "p", "t")).toMatchObject({ isRunning: false, attention: "completed" });
  const beforeRead = runtime.getTaskActivity();
  runtime.markTaskRunning("p", "t");
  runtime.reconcileTaskActivities([{ ...task, status: "failed" }], beforeRead);
  expect(getTaskActivity(runtime.getTaskActivity(), "p", "t").isRunning).toBe(true);
  expect(readTask).not.toHaveBeenCalled();
  runtime.dispose();
});
