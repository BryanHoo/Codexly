import type { TaskTimelineNavigationItem } from "@codexly/frontend-core/timeline-navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

export function useCurrentNavigationAnchor(
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
