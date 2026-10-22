export type SidebarTimelineGroup = "today" | "yesterday" | "week" | "earlier";
type TimelineTask = Readonly<{ id: string; projectId: string; updatedAt: string }>;
export type SidebarTimelineRow<T> =
  | Readonly<{ kind: "heading"; key: string; group: SidebarTimelineGroup; count: number }>
  | Readonly<{ kind: "task"; key: string; task: T }>;

/** 使用本地日历计算边界，避免夏令时切换时把一天误算成固定 24 小时。 */
export function sidebarTimelineDayStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function buildSidebarTimelineRows<T extends TimelineTask>(
  collections: readonly (readonly T[])[],
  now: Date,
): readonly SidebarTimelineRow<T>[] {
  const today = sidebarTimelineDayStart(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const byId = new Map<string, { task: T; time: number; key: string }>();
  for (const tasks of collections) {
    for (const task of tasks) {
      const parsed = Date.parse(task.updatedAt);
      const time = Number.isFinite(parsed) ? parsed : -Infinity;
      const key = JSON.stringify([task.projectId, task.id]);
      const previous = byId.get(key);
      // 跨页或缓存交叠只保留最新版本；解析一次时间，避免排序比较时反复解析。
      if (previous === undefined || time > previous.time) byId.set(key, { task, time, key });
    }
  }
  const sorted = [...byId.values()].sort(
    (left, right) =>
      right.time - left.time || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
  const groups: Record<SidebarTimelineGroup, SidebarTimelineRow<T>[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const { task, time, key } of sorted) {
    const group =
      time >= today ? "today" : time >= yesterday ? "yesterday" : time >= week ? "week" : "earlier";
    groups[group].push({ kind: "task", key, task });
  }
  return (Object.keys(groups) as SidebarTimelineGroup[]).flatMap((group) => {
    const tasks = groups[group];
    return tasks.length === 0
      ? []
      : [
          { kind: "heading" as const, key: `heading:${group}`, group, count: tasks.length },
          ...tasks,
        ];
  });
}
