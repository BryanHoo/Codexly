import type { TaskTimelineNavigationItem } from "@codexly/frontend-core/timeline-navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import { useCurrentNavigationAnchor } from "./timeline-navigation-anchor.js";
import { useTimelineNavigationHost } from "./timeline-navigation-host.js";

export type TimelineNavigationItems =
  readonly TaskTimelineNavigationItem[] | (() => readonly TaskTimelineNavigationItem[]);

// 刻度固定为 8px；两端统一只挂载视口及少量预渲染项，避免全量 Tooltip 订阅。
const NAVIGATION_ITEM_ESTIMATED_HEIGHT_PX = 8;
const NAVIGATION_INITIAL_RECT = { height: 360, width: 14 };
const NAVIGATION_OVERSCAN = 2;

export function TimelineNavigation({
  items: source,
  label,
  getJumpLabel,
  onNavigate,
  scrollContainerRef,
  scrollbarWidth,
}: Readonly<{
  items: TimelineNavigationItems;
  label: string;
  getJumpLabel: (index: number) => string;
  onNavigate: (item: TaskTimelineNavigationItem) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scrollbarWidth: number;
}>) {
  // 工厂仅在目录已挂载时调用；流式滚动与高亮更新复用同一份索引。
  const items = useMemo(() => (typeof source === "function" ? source() : source), [source]);
  const navigationHost = useTimelineNavigationHost(scrollContainerRef);
  const navigationRef = useRef<HTMLElement>(null);
  const getScrollElement = useCallback(() => navigationRef.current, []);
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: items.length,
    estimateSize: () => NAVIGATION_ITEM_ESTIMATED_HEIGHT_PX,
    getItemKey: (index) => items[index]?.anchorId ?? index,
    getScrollElement,
    initialRect: NAVIGATION_INITIAL_RECT,
    overscan: NAVIGATION_OVERSCAN,
  });
  const currentAnchorId = useCurrentNavigationAnchor(items, scrollContainerRef);
  if (items.length <= 1) {
    return null;
  }

  const navigation = (
    <nav
      aria-label={label}
      className="task-timeline-navigation"
      data-timeline-navigation=""
      ref={navigationRef}
      style={
        {
          "--conversation-scrollbar-width": `${String(scrollbarWidth)}px`,
        } as CSSProperties
      }
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) {
            return null;
          }
          return (
            <div
              className="absolute left-0 top-0 flex h-2 w-full"
              data-index={virtualItem.index}
              key={virtualItem.key}
              style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
            >
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={getJumpLabel(virtualItem.index + 1)}
                    aria-current={item.anchorId === currentAnchorId ? "location" : undefined}
                    className="h-2 w-full justify-end"
                    data-timeline-navigation-item={item.anchorId}
                    onClick={() => {
                      onNavigate(item);
                    }}
                    size="embedded"
                    type="button"
                    variant="embedded"
                  >
                    <span aria-hidden="true" className="task-timeline-navigation-marker" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  className="border border-separator-strong bg-raised px-3 py-2 text-body leading-6 text-foreground shadow-floating"
                  side="left"
                >
                  <span className="line-clamp-6 whitespace-pre-wrap">{item.preview}</span>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </nav>
  );

  if (typeof document === "undefined") return navigation;
  return navigationHost === null ? null : createPortal(navigation, navigationHost);
}
