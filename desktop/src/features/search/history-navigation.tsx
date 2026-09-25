import { useEffect, useRef, type RefObject } from "react";
import { createTaskItemKey } from "../conversation/runtime/task-store.js";

export type HistoryAnchor = Readonly<{
  turnId: string;
  itemId: string;
  query: string;
}>;

export function HistoryNavigation({
  target,
  turnIds,
  navigate,
  containerRef,
}: Readonly<{
  target: HistoryAnchor;
  turnIds: readonly string[];
  navigate: (index: number, anchorId: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}>) {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const container = containerRef.current;
    const index = turnIds.indexOf(target.turnId);
    if (container === null || index < 0) return;
    const anchorId = createTaskItemKey(target.turnId, target.itemId);
    let marked: HTMLElement | undefined;
    let frame = 0;
    // 等待虚拟列表完成首屏置底再定位；定位仅执行一次，不跟随实时文本反复滚动。
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => navigateRef.current(index, anchorId));
    });
    const highlight = () => {
      const element = Array.from(
        container.querySelectorAll<HTMLElement>("[data-conversation-anchor]"),
      ).find((node) => node.dataset["conversationAnchor"] === anchorId);
      if (element === undefined) return;
      marked = element;
      element.classList.add("search-message-match");
      element.setAttribute("data-search-match", "true");
      // CSS Highlight 不改写 React DOM；旧 WebView 保留消息级高亮。
      if (
        typeof Highlight !== "undefined" &&
        CSS.highlights !== undefined &&
        target.query
      ) {
        const ranges: Range[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const escaped = target.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "giu");
        let node: Node | null;
        while ((node = walker.nextNode()) !== null) {
          const text = node.textContent ?? "";
          for (const match of text.matchAll(pattern)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            ranges.push(range);
          }
        }
        CSS.highlights.set("global-search-match", new Highlight(...ranges));
      }
    };
    const observer = new MutationObserver(highlight);
    observer.observe(container, { childList: true, subtree: true });
    highlight();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      marked?.classList.remove("search-message-match");
      marked?.removeAttribute("data-search-match");
      if (typeof CSS !== "undefined" && CSS.highlights !== undefined)
        CSS.highlights.delete("global-search-match");
    };
  }, [containerRef, target, turnIds]);
  return null;
}
