import {
  listActiveTaskActivities,
  type ActiveTaskActivity,
  type TaskActivityMap,
} from "../conversation/runtime/task-activity.js";

export type TaskBoardTask = Readonly<{
  id: string;
  projectId: string;
  startedAt?: string;
  title: string;
  updatedAt?: string;
}>;

export type TaskBoardTaskGroups = Readonly<{
  approval: readonly TaskBoardTask[];
  running: readonly TaskBoardTask[];
}>; 

export function groupTaskBoardTasks(
  activity: TaskActivityMap,
  projectId: string | null,
): TaskBoardTaskGroups {
  const approval: ActiveTaskActivity[] = [];
  const running: ActiveTaskActivity[] = [];

  for (const task of listActiveTaskActivities(activity)) {
    if (projectId !== null && task.projectId !== projectId) continue;
    // Rust 区分普通等待输入与审批；审批任务必须优先归类，避免同一任务重复出现。
    if (task.status === "approval") {
      approval.push(task);
    } else {
      running.push(task);
    }
  }

  return { approval, running };
}
