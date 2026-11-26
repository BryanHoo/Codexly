import type { AgentEngine } from "@codexly/protocol";

export type SidebarActiveTask = Readonly<{
  engine?: AgentEngine | undefined;
  id: string;
  projectId: string;
  title: string;
  status: "approval" | "input" | "running";
}>;

type ActivityRecord = Readonly<{
  engine?: AgentEngine | undefined;
  taskId: string;
  projectId: string;
  taskName?: string;
  isRunning: boolean;
  attention: "approval" | "input" | "completed" | "failed" | null;
  pendingApprovalRequestIds: ReadonlySet<string>;
}>;

export function getSidebarActiveTasks(
  activity: ReadonlyMap<string, ActivityRecord>,
  projectIds: ReadonlySet<string>,
) {
  const approval: SidebarActiveTask[] = [];
  const running: SidebarActiveTask[] = [];
  // 活动记录独立于项目分页，收起项目或尚未加载历史时也不能漏掉运行任务。
  // 保持组内顺序稳定，待审批和待输入任务优先显示。
  for (const record of activity.values()) {
    if (!projectIds.has(record.projectId)) continue;
    const waiting = record.pendingApprovalRequestIds.size > 0;
    const status = waiting
      ? "approval"
      : record.attention === "input"
        ? "input"
        : record.isRunning
          ? "running"
          : null;
    if (status === null) continue;
    // 完成与失败提醒留在任务原有行，运行中栏目只收录仍需执行或处理的任务。
    (status === "running" ? running : approval).push({
      // 活动可能先于完整快照到达；原样传递未知引擎，不能误标成 Codex。
      engine: record.engine,
      id: record.taskId,
      projectId: record.projectId,
      title: record.taskName ?? record.taskId,
      status,
    });
  }
  return {
    tasks: [...approval, ...running],
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
