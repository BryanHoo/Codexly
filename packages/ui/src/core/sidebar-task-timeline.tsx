import { LoadingSkeleton } from "./loading-skeleton.js";
import type { AgentTask } from "@codexly/protocol";
import { ChevronDown, ChevronRight } from "lucide-react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildSidebarTimelineRows,
  sidebarTimelineDayStart,
  type SidebarTimelineGroup,
  type SidebarTimelineRow,
} from "@codexly/frontend-core/sidebar-task-timeline";
import {
  readSidebarTimelineCollapsedGroups,
  writeSidebarTimelineCollapsedGroups,
} from "@codexly/frontend-core/sidebar-task-view";
import { Button } from "./button.js";
import {
  useSidebarTimelineCatalog,
  type SidebarTimelineQuery,
} from "./sidebar-task-timeline-data.js";

const rowHeight = 32;

export function SidebarTaskTimeline({
  queries,
  renderTask,
  labels,
  onNavigate,
  storage,
}: Readonly<{
  queries: readonly SidebarTimelineQuery[];
  renderTask: (task: AgentTask) => ReactNode;
  labels: Readonly<{
    groups: Record<SidebarTimelineGroup, string>;
    title: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
  }>;
  onNavigate?: (() => void) | undefined;
  storage?: Parameters<typeof readSidebarTimelineCollapsedGroups>[0];
}>) {
  const [day, setDay] = useState(() => sidebarTimelineDayStart(new Date()));
  const [collapsedGroups, setCollapsedGroups] = useState(() =>
    readSidebarTimelineCollapsedGroups(storage),
  );
  const catalog = useSidebarTimelineCatalog(queries, !collapsedGroups.has("earlier"), day);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      const now = new Date();
      setDay(sidebarTimelineDayStart(now));
      // 只在自然日边界唤醒；后台暂停，恢复窗口时校准日期及本地时区。
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      timer = setTimeout(update, next - now.getTime() + 50);
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  const allRows = useMemo((): readonly SidebarTimelineRow<AgentTask>[] => {
    const grouped = buildSidebarTimelineRows(catalog.collections, new Date(day));
    return catalog.hasEarlier &&
      !grouped.some((row) => row.kind === "heading" && row.group === "earlier")
      ? [
          ...grouped,
          {
            kind: "heading",
            key: "heading:earlier",
            group: "earlier",
            count: catalog.earlierCount ?? 0,
          },
        ]
      : grouped;
  }, [catalog.collections, catalog.hasEarlier, catalog.earlierCount, day]);
  const rows = useMemo(() => {
    // 收起仅投影可见行，不重新解析时间或排序；组标题始终保留完整任务数量。
    let collapsed = false;
    return allRows.filter((row) => {
      if (row.kind === "heading") collapsed = collapsedGroups.has(row.group);
      return row.kind === "heading" || !collapsed;
    });
  }, [allRows, collapsedGroups]);
  const groups = useMemo(() => {
    const headings = rows.flatMap((row, index) => (row.kind === "heading" ? [index] : []));
    return headings.map((start, index) => ({ start, end: headings[index + 1] ?? rows.length }));
  }, [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusedIndex = useMemo(
    () => rows.findIndex((row) => row.key === focusedKey),
    [rows, focusedKey],
  );
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
  // 收起后继续使用同一虚拟容器，避免切换渲染分支使标题按钮丢失键盘焦点。
  const virtual = allRows.length > 80;
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled: virtual,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    // 键盘跳转要避开吸顶标题，不能让目标任务被标题覆盖。
    scrollPaddingStart: rowHeight,
    getItemKey,
    overscan: 6,
    rangeExtractor: useCallback(
      (range) => {
        const indices = defaultRangeExtractor(range);
        // 键盘焦点或操作菜单所在行离开视口时仍保留节点，避免滚动导致菜单意外卸载。
        return focusedIndex < 0
          ? indices
          : [...new Set([...indices, focusedIndex])].sort((a, b) => a - b);
      },
      [focusedIndex],
    ),
  });
  const virtualRows = virtualizer.getVirtualItems();
  const renderRow = (index: number) => {
    const row = rows[index];
    if (row === undefined) return null;
    return row.kind === "heading" ? (
      <h3 className="h-8 min-w-0">
        <Button
          variant="ghost"
          contentAlign="start"
          type="button"
          aria-expanded={!collapsedGroups.has(row.group)}
          className="h-8 w-full gap-2 rounded-control bg-control-active/50 px-2 text-body-small font-semibold text-foreground hover:bg-control-hover"
          onClick={() => {
            const next = new Set(collapsedGroups);
            if (next.has(row.group)) next.delete(row.group);
            else next.add(row.group);
            writeSidebarTimelineCollapsedGroups(storage, next);
            setCollapsedGroups(next);
          }}
        >
          {collapsedGroups.has(row.group) ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="truncate" data-timeline-group-title>
            {labels.groups[row.group]}
          </span>
          <span
            className="ml-auto min-w-5 shrink-0 rounded bg-sidebar/80 px-1 text-center text-caption font-medium tabular-nums text-muted-foreground"
            data-timeline-group-count
          >
            {row.group === "earlier" && catalog.earlierCount === null ? "…" : row.count}
          </span>
        </Button>
      </h3>
    ) : (
      renderTask(row.task)
    );
  };
  return (
    <div
      ref={scrollRef}
      className="min-h-0 min-w-0 flex-1 scroll-pt-8 overflow-x-hidden overflow-y-auto pb-3"
      data-testid="sidebar-task-timeline"
      role="region"
      aria-label={labels.title}
      aria-busy={catalog.isPending}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-timeline-row]");
        if (row) setFocusedKey(row.dataset["timelineRow"] ?? null);
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("a") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        )
          onNavigate?.();
      }}
      onKeyDown={(event) => {
        if (
          !(event.target instanceof HTMLAnchorElement) ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const step = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
        let index =
          event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : focusedIndex + step;
        while (index >= 0 && index < rows.length && rows[index]?.kind !== "task") index += step;
        const row = rows[index];
        if (row?.kind !== "task") return;
        event.preventDefault();
        setFocusedKey(row.key);
        if (virtual) virtualizer.scrollToIndex(index, { align: "auto" });
        requestAnimationFrame(() => {
          const element = [
            ...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-timeline-row]") ?? []),
          ].find((element) => element.dataset["timelineRow"] === row.key);
          element?.querySelector("a")?.focus({ preventScroll: virtual });
        });
      }}
    >
      {/* 已有部分项目结果时保留列表，只在整个时间线尚无内容时显示骨架。 */}
      {catalog.isPending && rows.length === 0 ? (
        <LoadingSkeleton className="px-2 py-1.5" label={labels.loading} />
      ) : null}
      {catalog.failures.length > 0 ? (
        <div className="px-2 py-1.5 text-meta text-danger" role="alert">
          {labels.error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void Promise.allSettled(
                catalog.failures.map((refetch) => refetch({ cancelRefetch: false })),
              );
            }}
          >
            {labels.retry}
          </Button>
        </div>
      ) : null}
      {!catalog.isPending && catalog.failures.length === 0 && rows.length === 0 ? (
        <p className="px-2 py-1.5 text-meta text-subtle-foreground">{labels.empty}</p>
      ) : null}
      <div
        style={virtual ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
      >
        {groups.map((group) => (
          <section
            key={rows[group.start]?.key}
            className="min-w-0"
            style={
              virtual
                ? {
                    position: "absolute",
                    top: group.start * rowHeight,
                    width: "100%",
                    height: (group.end - group.start) * rowHeight,
                  }
                : undefined
            }
          >
            {/* 每组保留一个不带 transform 的容器：原生 sticky 在组尾自然退出，下一标题接替。 */}
            <div
              className="sticky top-0 z-10 bg-sidebar"
              data-timeline-row={rows[group.start]?.key}
            >
              {renderRow(group.start)}
            </div>
            {virtual
              ? virtualRows
                  .filter((item) => item.index > group.start && item.index < group.end)
                  .map((item) => (
                    <div
                      key={item.key}
                      data-timeline-row={rows[item.index]?.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        width: "100%",
                        height: rowHeight,
                        transform: `translateY(${String(item.start - group.start * rowHeight)}px)`,
                      }}
                    >
                      {renderRow(item.index)}
                    </div>
                  ))
              : rows.slice(group.start + 1, group.end).map((row, index) => (
                  <div key={row.key} data-timeline-row={row.key}>
                    {renderRow(group.start + 1 + index)}
                  </div>
                ))}
          </section>
        ))}
      </div>
    </div>
  );
}
