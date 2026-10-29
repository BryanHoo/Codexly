import { useConversationDisplayPreference } from "@codexly/ui/core/conversation-display-preferences";
import { conversationDisplayPreferences } from "../../settings/conversation-display-preferences.js";
import type { ComponentProps } from "react";
import { useCurrentNavigationAnchor } from "@codexly/ui/core/timeline-navigation-anchor";
import {
  getTaskTimelineNavigationItems as getSharedNavigationItems,
  getUserMessageNavigationPreview,
  type TaskTimelineNavigationItem,
} from "@codexly/frontend-core/timeline-navigation";
export type { TaskTimelineNavigationItem } from "@codexly/frontend-core/timeline-navigation";
import { useTimelineNavigationHost } from "@codexly/ui/core/timeline-navigation-host";
import type { AgentItem } from "@codexly/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { TaskStoreState } from "../../conversation/runtime/task-store.js";

import { getReviewMessageText } from "./task-timeline-running.js";

const NAVIGATION_ITEM_ESTIMATED_HEIGHT_PX = 44;
const NAVIGATION_INITIAL_RECT = { height: 360, width: 44 };
const NAVIGATION_OVERSCAN = 2;

function getNavigationPreview(item: AgentItem): string | null {
  if (item.type === "review") {
    return getReviewMessageText(item);
  }
  if (item.type !== "message" || item.role !== "user") {
    return null;
  }

  return getUserMessageNavigationPreview(item);
}

export function getTaskTimelineNavigationItems(
  state: Pick<TaskStoreState, "itemKeysByTurnId" | "itemStoresByKey" | "turnIds">,
): TaskTimelineNavigationItem[] {
  return getSharedNavigationItems(state, getNavigationPreview);
}

/** 禁用时不挂载目录、锚点观察器和导航浮层，搜索定位仍由外层独立执行。 */
export function TaskTimelineNavigation(
  props: ComponentProps<typeof EnabledTaskTimelineNavigation>,
) {
  const enabled = useConversationDisplayPreference(conversationDisplayPreferences, "navigation");
  return enabled ? <EnabledTaskTimelineNavigation {...props} /> : null;
}

function EnabledTaskTimelineNavigation({
  items,
  onNavigate,
  scrollContainerRef,
  scrollbarWidth,
}: Readonly<{
  items: readonly TaskTimelineNavigationItem[];
  onNavigate: (item: TaskTimelineNavigationItem) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scrollbarWidth: number;
}>) {
  const navigationHost = useTimelineNavigationHost(scrollContainerRef);
  const { t } = useTranslation("conversation");
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
      aria-label={t("timeline.quickNavigation")}
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
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
            >
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("timeline.jumpToMessage", { index: virtualItem.index + 1 })}
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
