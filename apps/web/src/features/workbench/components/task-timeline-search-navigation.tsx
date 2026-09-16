import type { RefObject } from "react";

import { HistoryNavigation, type HistoryAnchor } from "../../search/history-navigation.js";
import {
  TaskTimelineNavigation,
  type TaskTimelineNavigationItem,
} from "./task-timeline-navigation.js";

export function TaskTimelineSearchNavigation({
  items,
  navigateToItem,
  scrollContainerRef,
  scrollbarWidth,
  searchTarget,
  turnIds,
}: Readonly<{
  items: readonly TaskTimelineNavigationItem[];
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
