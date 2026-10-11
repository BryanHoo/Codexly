import { useCurrentNavigationAnchor } from "@codexly/ui/core/timeline-navigation-anchor";
import {
  getTaskTimelineNavigationItems as getSharedNavigationItems,
  getUserMessageNavigationPreview,
  type TaskTimelineNavigationItem,
} from "@codexly/frontend-core/timeline-navigation";
export type { TaskTimelineNavigationItem } from "@codexly/frontend-core/timeline-navigation";
import { useTimelineNavigationHost } from "@codexly/ui/core/timeline-navigation-host";
import type { AgentItem } from "@/protocol/index.js";
import {
  type CSSProperties,
  type RefObject,
} from "react";
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

export function TaskTimelineNavigation({
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
  const currentAnchorId = useCurrentNavigationAnchor(items, scrollContainerRef);
  if (items.length <= 1) {
    return null;
  }

  const navigation = (
    <nav
      aria-label={t("timeline.quickNavigation")}
      className="task-timeline-navigation"
      data-timeline-navigation=""
      style={
        {
          "--conversation-scrollbar-width": `${String(scrollbarWidth)}px`,
        } as CSSProperties
      }
    >
      <div className="flex w-full flex-col">
        {items.map((item, index) => (
          <div className="flex h-2 w-full" data-index={index} key={item.anchorId}>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t("timeline.jumpToMessage", { index: index + 1 })}
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
        ))}
      </div>
    </nav>
  );

  if (typeof document === "undefined") return navigation;
  return navigationHost === null ? null : createPortal(navigation, navigationHost);
}
