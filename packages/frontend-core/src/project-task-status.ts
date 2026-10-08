export type ProjectTaskStatus = "completed" | "approval" | "running";

type ProjectTaskActivity = Readonly<{
  attention: "completed" | "approval" | "failed" | null;
  isRunning: boolean;
  pendingApprovalRequestIds: ReadonlySet<string>;
  projectId: string;
}>;

const statusPriority = { completed: 3, approval: 2, running: 1 } as const;

export function getProjectTaskStatuses(
  activity: ReadonlyMap<string, ProjectTaskActivity>,
): ReadonlyMap<string, ProjectTaskStatus> {
  const statuses = new Map<string, ProjectTaskStatus>();
  // 单次遍历完整活动记录，避免按项目重复扫描，也不受任务分页或搜索过滤影响。
  for (const record of activity.values()) {
    const status =
      record.attention === "completed"
        ? "completed"
        : record.pendingApprovalRequestIds.size > 0 || record.attention === "approval"
          ? "approval"
          : record.isRunning
            ? "running"
            : null;
    if (status === null) continue;
    const current = statuses.get(record.projectId);
    // 仅未查看的完成态参与聚合；查看后由原有 attention 清除流程自动回落。
    if (current === undefined || statusPriority[status] > statusPriority[current]) {
      statuses.set(record.projectId, status);
    }
  }
  return statuses;
}
