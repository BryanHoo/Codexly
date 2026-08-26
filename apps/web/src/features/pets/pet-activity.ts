import { TEMPORARY_TASK_SCOPE_ID, type AgentTask, type Project } from "@codexly/protocol";

import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";

export type WorkbenchPetTaskActivity = Readonly<{
  projectId: string;
  rootPath: string;
  status: "completed" | "running" | "waiting";
  taskId: string;
  taskName: string;
}>;

export type WorkbenchPetActivity = Readonly<{
  animationName: "failed" | "idle" | "review" | "running" | "waiting";
  tasks: readonly WorkbenchPetTaskActivity[];
}>;

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

export function deriveWorkbenchPetActivity(
  projects: readonly Project[],
  tasks: readonly AgentTask[],
  taskActivity: TaskActivityMap,
): WorkbenchPetActivity {
  const projectRootPaths = new Map<string, string>();
  const taskNames = new Map(tasks.map((task) => [taskKey(task.projectId, task.id), task.title]));
  for (const project of projects) {
    const rootPath = project.roots[0]?.path;
    if (rootPath !== undefined) projectRootPaths.set(project.id, rootPath);
  }

  const activeTasks: WorkbenchPetTaskActivity[] = [];
  let failed = false;
  let review = false;
  let running = false;
  let waiting = false;
  for (const record of taskActivity.values()) {
    const awaitingInput =
      record.pendingApprovalRequestIds.size > 0 || record.attention === "approval";
    const completed = record.attention === "completed";
    waiting ||= awaitingInput;
    failed ||= record.attention === "failed";
    running ||= record.isRunning;
    review ||= completed;

    // 后台完成提醒由 viewTask 清除，在用户进入对应 Task 前持续保留气泡。
    if (
      record.projectId === TEMPORARY_TASK_SCOPE_ID ||
      (!record.isRunning && !awaitingInput && !completed)
    ) {
      continue;
    }
    const rootPath = projectRootPaths.get(record.projectId);
    if (rootPath === undefined) continue;
    activeTasks.push({
      projectId: record.projectId,
      rootPath,
      status: awaitingInput ? "waiting" : completed ? "completed" : "running",
      taskId: record.taskId,
      taskName: taskNames.get(taskKey(record.projectId, record.taskId)) ?? record.taskId,
    });
  }

  return {
    animationName: waiting
      ? "waiting"
      : failed
        ? "failed"
        : running
          ? "running"
          : review
            ? "review"
            : "idle",
    tasks: activeTasks,
  };
}
