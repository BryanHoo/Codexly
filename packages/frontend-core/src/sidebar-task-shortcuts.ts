export type SidebarActiveTask = Readonly<{
  id: string;
  projectId: string;
  title: string;
  status: "approval" | "running" | "completed";
}>;

type ActivityRecord = Readonly<{
  taskId: string;
  projectId: string;
  taskName?: string;
  isRunning: boolean;
  attention: "approval" | "completed" | "failed" | null;
  pendingApprovalRequestIds: ReadonlySet<string>;
}>;

export function getSidebarActiveTasks(
  activity: ReadonlyMap<string, ActivityRecord>,
  projectIds: ReadonlySet<string>,
) {
  const approval: SidebarActiveTask[] = [];
  const running: SidebarActiveTask[] = [];
  const completed: SidebarActiveTask[] = [];
  // 活动记录独立于项目分页，收起项目或尚未加载历史时也不能漏掉运行任务。
  // Map 插入顺序不随流式更新改变；未查看完成优先，其后为待审批、运行。
  for (const record of activity.values()) {
    if (!projectIds.has(record.projectId)) continue;
    const waiting = record.pendingApprovalRequestIds.size > 0;
    const status = waiting
      ? "approval"
      : record.isRunning
        ? "running"
        : record.attention === "completed"
          ? "completed"
          : null;
    if (status === null) continue;
    // 完成提醒由两端现有的任务聚焦流程清除；保留入口并参与分组总数，实际运行数独立统计。
    (status === "approval" ? approval : status === "running" ? running : completed).push({
      id: record.taskId,
      projectId: record.projectId,
      title: record.taskName ?? record.taskId,
      status,
    });
  }
  return {
    tasks: [...completed, ...approval, ...running],
    approvalCount: approval.length,
    runningCount: running.length,
  };
}

export function getSidebarShortcutLayout(
  availableHeight: number,
  pinnedCount: number,
  activeCount: number,
  pinnedExpanded: boolean,
  activeExpanded: boolean,
) {
  let pinnedLimit = pinnedExpanded ? Math.min(2, pinnedCount) : 0;
  let activeLimit = activeExpanded ? Math.min(2, activeCount) : 0;
  const groupHeight = (count: number, limit: number) =>
    count === 0 ? 0 : 28 + limit * 32 + (limit > 0 && limit < count ? 24 : 0);
  const height = () =>
    groupHeight(pinnedCount, pinnedLimit) +
    groupHeight(activeCount, activeLimit) +
    (pinnedCount > 0 && activeCount > 0 ? 8 : 0);
  const budget = Math.min(240, Math.max(0, availableHeight) / 3);
  // 窗口变矮时先把两组压到一条，再收起固定预览，尽量保留待确认/运行入口。
  // 标题计数始终可以打开完整列表；极小窗口保留标题的最小可操作高度。
  for (const group of ["pinned", "active", "pinned", "active"] as const) {
    if (height() <= budget) break;
    if (group === "pinned") pinnedLimit = Math.max(0, pinnedLimit - 1);
    else activeLimit = Math.max(0, activeLimit - 1);
  }
  return { pinnedLimit, activeLimit, height: height() };
}

type ShortcutExpanded = Readonly<{ pinned: boolean; active: boolean }>;
type PreferenceStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;
const preferenceKey = "codexly:sidebar:shortcuts-expanded:v1";

export function readSidebarShortcutExpanded(
  storage: PreferenceStorage | undefined,
): ShortcutExpanded {
  try {
    const value: unknown = JSON.parse(storage?.getItem(preferenceKey) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 1 &&
      "pinned" in value &&
      typeof value.pinned === "boolean" &&
      "active" in value &&
      typeof value.active === "boolean"
    ) {
      return { pinned: value.pinned, active: value.active };
    }
  } catch {
    // 存储损坏、隐私模式或读取被禁用时回退到默认预览，不阻断侧栏。
  }
  return { pinned: true, active: true };
}

export function writeSidebarShortcutExpanded(
  storage: PreferenceStorage | undefined,
  expanded: ShortcutExpanded,
) {
  try {
    storage?.setItem(preferenceKey, JSON.stringify({ version: 1, ...expanded }));
  } catch {
    // 跨会话保存失败时保留本次手动折叠状态。
  }
}
