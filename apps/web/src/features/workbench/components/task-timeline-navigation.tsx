import type { AgentItem } from "@codexly/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
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

const NAVIGATION_ITEM_ESTIMATED_HEIGHT_PX = 44;
const NAVIGATION_INITIAL_RECT = { height: 360, width: 44 };
const NAVIGATION_OVERSCAN = 2;

export type TaskTimelineNavigationItem = Readonly<{
  anchorId: string;
  preview: string;
  turnIndex: number;
}>;

function getNavigationPreview(item: AgentItem): string | null {
  if (item.type === "review") {
    return getReviewMessageText(item);
  }
  if (item.type !== "message" || item.role !== "user") {
    return null;
  }

  // 预览按消息中的可见顺序保留 Skill、正文和附件名称，不改写用户原文。
  const parts = [
    ...(item.skills ?? []).map((skill) => `$${skill.name}`),
    item.text,
    ...(item.attachments ?? []).map((attachment) => attachment.name),
  ].filter((part) => part.length > 0);
  return parts.join("\n");
}

export function getTaskTimelineNavigationItems(
  state: Pick<TaskStoreState, "itemKeysByTurnId" | "itemStoresByKey" | "turnIds">,
): TaskTimelineNavigationItem[] {
  const items: TaskTimelineNavigationItem[] = [];
  state.turnIds.forEach((turnId, turnIndex) => {
    for (const itemKey of state.itemKeysByTurnId[turnId] ?? []) {
      const item = state.itemStoresByKey.get(itemKey)?.peek();
      if (item === undefined) {
        continue;
      }
      const preview = getNavigationPreview(item);
      if (preview !== null) {
        items.push({ anchorId: itemKey, preview, turnIndex });
      }
    }
  });
  return items;
}

function useCurrentNavigationAnchor(
  items: readonly TaskTimelineNavigationItem[],
  scrollContainerRef: RefObject<HTMLDivElement | null>,
) {
  const [currentAnchorId, setCurrentAnchorId] = useState<string | null>(items[0]?.anchorId ?? null);
  const frameRef = useRef(0);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container === null) {
      return;
    }
    const itemIndexes = new Map(items.map((item, index) => [item.anchorId, index]));
    const updateCurrentAnchor = () => {
      const readingLine =
        container.getBoundingClientRect().top + Math.min(container.clientHeight * 0.25, 160);
      let currentIndex = 0;

      // 以阅读区域上四分之一处为基准，保持当前刻度与用户正在阅读的消息一致。
      for (const anchor of container.querySelectorAll<HTMLElement>("[data-conversation-anchor]")) {
        const anchorId = anchor.dataset["conversationAnchor"];
        const anchorIndex = anchorId === undefined ? undefined : itemIndexes.get(anchorId);
        if (anchorIndex === undefined) {
          continue;
        }
        if (anchor.getBoundingClientRect().top > readingLine) {
          break;
        }
        currentIndex = anchorIndex;
      }
      setCurrentAnchorId(items[currentIndex]?.anchorId ?? null);
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(updateCurrentAnchor);
    };

    scheduleUpdate();
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(container);
    return () => {
      container.removeEventListener("scroll", scheduleUpdate);
      resizeObserver.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, [items, scrollContainerRef]);

  return currentAnchorId;
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

  // 提升到 Workbench 根层，避免滚动容器裁剪固定目录与 Hover 预览。
  if (typeof document === "undefined") {
    return navigation;
  }
  return createPortal(
    navigation,
    document.querySelector<HTMLElement>(".workbench-shell") ?? document.body,
  );
}
