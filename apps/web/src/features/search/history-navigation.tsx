import { useEffect, useRef, type RefObject } from "react";

import { createTaskItemKey } from "../conversation/runtime/task-store.js";

export type HistoryAnchor = Readonly<{
  highlightText: string;
  itemId: string;
  query: string;
  turnId: string;
}>;

function createTextRanges(element: HTMLElement, searchText: string): Range[] {
  if (!searchText) return [];
  const nodes: Text[] = [];
  const starts: number[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const textNode = node as Text;
    starts.push(text.length);
    nodes.push(textNode);
    text += textNode.data;
  }

  const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(escaped, "giu");
  const ranges: Range[] = [];
  for (const match of text.matchAll(pattern)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const startIndex = nodes.findIndex(
      (textNode, index) => matchStart < (starts[index] ?? 0) + textNode.data.length,
    );
    const endIndex = nodes.findIndex(
      (textNode, index) => matchEnd <= (starts[index] ?? 0) + textNode.data.length,
    );
    const startNode = nodes[startIndex];
    const endNode = nodes[endIndex];
    if (startNode === undefined || endNode === undefined) continue;
    const range = document.createRange();
    range.setStart(startNode, matchStart - (starts[startIndex] ?? 0));
    range.setEnd(endNode, matchEnd - (starts[endIndex] ?? 0));
    ranges.push(range);
  }
  return ranges;
}

export function HistoryNavigation({
  containerRef,
  navigate,
  target,
  turnIds,
}: Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  navigate: (index: number, anchorId: string) => void;
  target: HistoryAnchor;
  turnIds: readonly string[];
}>) {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const container = containerRef.current;
    const index = turnIds.indexOf(target.turnId);
    if (container === null || index < 0) return;
    const anchorId = createTaskItemKey(target.turnId, target.itemId);
    let marked: HTMLElement | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        navigateRef.current(index, anchorId);
      });
    });
    const highlight = () => {
      const element = Array.from(
        container.querySelectorAll<HTMLElement>("[data-conversation-anchor]"),
      ).find((node) => node.dataset["conversationAnchor"] === anchorId);
      if (element === undefined) return;
      marked = element;
      element.setAttribute("data-search-match", "true");
      // 使用后端命中范围提取的原文，并把 Markdown 拆开的文本节点拼接后映射回 DOM Range。
      let ranges = createTextRanges(element, target.highlightText);
      if (ranges.length === 0 && target.query.trim() !== target.highlightText) {
        ranges = createTextRanges(element, target.query.trim());
      }
      if (ranges.length > 0) {
        CSS.highlights.set("global-search-match", new Highlight(...ranges));
      }
    };
    const observer = new MutationObserver(highlight);
    observer.observe(container, { childList: true, subtree: true });
    highlight();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      marked?.removeAttribute("data-search-match");
      CSS.highlights.delete("global-search-match");
    };
  }, [containerRef, target, turnIds]);
  return null;
}
