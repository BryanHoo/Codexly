import type { TaskTimelineNavigationItem } from "@codexly/frontend-core/timeline-navigation";
import { useEffect, useState, type RefObject } from "react";

const ANCHOR_SELECTOR = "[data-conversation-anchor]";

function containsAnchor(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(ANCHOR_SELECTOR) || node.querySelector(ANCHOR_SELECTOR) !== null)
  );
}

export function useCurrentNavigationAnchor(
  items: readonly TaskTimelineNavigationItem[],
  scrollContainerRef: RefObject<HTMLDivElement | null>,
) {
  const [currentAnchorId, setCurrentAnchorId] = useState<string | null>(items[0]?.anchorId ?? null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container === null || items.length <= 1) return;
    const itemIds = new Set(items.map((item) => item.anchorId));
    let anchors: HTMLElement[] = [];
    let anchorsDirty = true;
    let frame: number | null = null;

    const updateCurrentAnchor = () => {
      frame = null;
      // 仅在锚点增删、改名或索引变化时重建节点列表；正文增量不重扫历史。
      if (anchorsDirty) {
        anchors = Array.from(container.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR)).filter(
          (anchor) => itemIds.has(anchor.dataset["conversationAnchor"] ?? ""),
        );
        anchorsDirty = false;
      }
      const readingLine =
        container.getBoundingClientRect().top + Math.min(container.clientHeight * 0.25, 160);
      let start = 0;
      let end = anchors.length;
      // 节点按文档顺序排列；二分读取实时位置，既减少布局读取，也不缓存会因
      // 图片加载、过程折叠和历史补页失效的绝对坐标。
      while (start < end) {
        const middle = (start + end) >>> 1;
        const anchor = anchors[middle];
        if (anchor !== undefined && anchor.getBoundingClientRect().top <= readingLine)
          start = middle + 1;
        else end = middle;
      }
      setCurrentAnchorId(
        (start > 0 ? anchors[start - 1]?.dataset["conversationAnchor"] : undefined) ??
          items[0]?.anchorId ??
          null,
      );
    };
    const scheduleUpdate = () => {
      // 同帧合并滚动、内容变更和尺寸通知，避免取消并重排已有任务。
      frame ??= requestAnimationFrame(updateCurrentAnchor);
    };
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === "attributes" ||
          (record.type === "childList" &&
            [...record.addedNodes, ...record.removedNodes].some(containsAnchor))
        ) {
          anchorsDirty = true;
          break;
        }
      }
      // 普通正文变更交给内容尺寸观察器；行高未变时无需唤醒目录测量。
      if (anchorsDirty) scheduleUpdate();
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-conversation-anchor"],
    });
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(container);
    // 内容与视口分开观察；视口固定时，图片和异步正文仍可能改变阅读线附近的位置。
    const content = container.querySelector('[data-slot="message-scroller-content"]');
    if (content !== null) resizeObserver.observe(content);
    scheduleUpdate();
    return () => {
      container.removeEventListener("scroll", scheduleUpdate);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [items, scrollContainerRef]);

  return currentAnchorId;
}
