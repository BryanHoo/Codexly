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
}>;

export function groupTaskBoardTasks(activity: TaskActivityMap, projectId: string | null) {
  const approval: ActiveTaskActivity[] = [];
  const running: ActiveTaskActivity[] = [];
  for (const task of listActiveTaskActivities(activity)) {
    if (projectId !== null && task.projectId !== projectId) continue;
    // 审批状态优先，确保同一任务只进入一个看板列。
    (task.status === "approval" ? approval : running).push(task);
  }
  return { approval, running } as const;
}
