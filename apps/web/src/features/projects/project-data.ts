import type { AgentTask } from "@code-agent/protocol";

export const PROJECT_TASK_PREVIEW_LIMIT = 5;

export function getPinnedTasks(tasks: readonly AgentTask[]) {
  return tasks.filter((task) => task.pinned);
}

export function getProjectTaskPreview(tasks: readonly AgentTask[], expanded: boolean) {
  if (expanded || tasks.length <= PROJECT_TASK_PREVIEW_LIMIT) {
    return { hasMore: false, tasks } as const;
  }
  return { hasMore: true, tasks: tasks.slice(0, PROJECT_TASK_PREVIEW_LIMIT) } as const;
}

export function formatTaskAge(updatedAt: string) {
  const elapsedMinutes = Math.max(1, Math.floor((Date.now() - Date.parse(updatedAt)) / 60_000));

  // 一小时内保留分钟精度，避免新任务统一显示为 1h。
  if (elapsedMinutes < 60) {
    return `${String(elapsedMinutes)}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${String(elapsedHours)}h`;
  }
  return `${String(Math.floor(elapsedHours / 24))}d`;
}
