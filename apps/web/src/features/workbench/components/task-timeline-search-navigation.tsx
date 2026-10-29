import type { RefObject } from "react";
import type { TimelineNavigationItems } from "@codexly/ui/core/timeline-navigation";

import { HistoryNavigation, type HistoryAnchor } from "../../search/history-navigation.js";
import { TaskTimelineNavigation } from "./task-timeline-navigation.js";

export function TaskTimelineSearchNavigation({
  items,
  navigateToItem,
  scrollContainerRef,
  scrollbarWidth,
  searchTarget,
  turnIds,
}: Readonly<{
  items: TimelineNavigationItems;
  navigateToItem: (index: number, anchorId: string) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scrollbarWidth: number;
  searchTarget?: HistoryAnchor;
  turnIds: readonly string[];
}>) {
  return (
    <>
      {searchTarget === undefined ? null : (
        <HistoryNavigation
          containerRef={scrollContainerRef}
          navigate={navigateToItem}
          target={searchTarget}
          turnIds={turnIds}
        />
      )}
      <TaskTimelineNavigation
        items={items}
        onNavigate={(item) => {
          navigateToItem(item.turnIndex, item.anchorId);
        }}
        scrollContainerRef={scrollContainerRef}
        scrollbarWidth={scrollbarWidth}
      />
    </>
  );
}
