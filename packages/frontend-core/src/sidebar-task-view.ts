import type { SidebarTimelineGroup } from "./sidebar-task-timeline.js";

export type SidebarTaskView = "projects" | "timeline";
type PreferenceStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;
const preferenceKey = "codexly:sidebar:task-view:v1";
const collapsedGroupsKey = "codexly:sidebar:timeline-collapsed-groups:v1";

export const sidebarTimelineChinese = {
  title: "任务时间线",
  showTimeline: "切换为时间线",
  showProjects: "切换为项目分组",
  today: "今天",
  yesterday: "昨天",
  week: "近 7 天",
  earlier: "更早",
};
export const sidebarTimelineEnglish = {
  title: "Task timeline",
  showTimeline: "Switch to timeline",
  showProjects: "Switch to project groups",
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  earlier: "Earlier",
};

export function readSidebarTaskView(storage: PreferenceStorage | undefined): SidebarTaskView {
  try {
    const value: unknown = JSON.parse(storage?.getItem(preferenceKey) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 1 &&
      "view" in value &&
      (value.view === "projects" || value.view === "timeline")
    )
      return value.view;
  } catch {
    // 偏好不可读或格式损坏时保留默认入口，不阻断任务导航。
  }
  return "projects";
}

export function writeSidebarTaskView(
  storage: PreferenceStorage | undefined,
  view: SidebarTaskView,
): void {
  try {
    storage?.setItem(preferenceKey, JSON.stringify({ version: 1, view }));
  } catch {
    // 存储不可写时仍允许在当前会话即时切换。
  }
}

export function readSidebarTimelineCollapsedGroups(
  storage: PreferenceStorage | undefined,
): ReadonlySet<SidebarTimelineGroup> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(collapsedGroupsKey) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 1 &&
      "collapsedGroups" in value &&
      Array.isArray(value.collapsedGroups) &&
      value.collapsedGroups.every(
        (group): group is SidebarTimelineGroup =>
          group === "today" || group === "yesterday" || group === "week" || group === "earlier",
      )
    ) {
      return new Set(value.collapsedGroups);
    }
  } catch {
    // 默认收起历史组；用户显式展开后保存的选择仍优先恢复。
  }
  return new Set(["earlier"]);
}

export function writeSidebarTimelineCollapsedGroups(
  storage: PreferenceStorage | undefined,
  collapsedGroups: ReadonlySet<SidebarTimelineGroup>,
): void {
  try {
    storage?.setItem(
      collapsedGroupsKey,
      JSON.stringify({ version: 1, collapsedGroups: [...collapsedGroups] }),
    );
  } catch {
    // 存储不可写时保留当前页面的收起状态，不阻断操作。
  }
}
