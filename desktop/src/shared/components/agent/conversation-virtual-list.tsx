import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";

const DEFAULT_TURN_ESTIMATED_HEIGHT_PX = 900;
const HEADER_ESTIMATED_HEIGHT_PX = 48;
const FOOTER_ESTIMATED_HEIGHT_PX = 160;
const TURN_GAP_PX = 24;
const TURN_OVERSCAN = 2;
const SCROLL_END_THRESHOLD_PX = 80;
const VERTICAL_PADDING_PX = 28;

type ItemBoundary = Readonly<{
  firstKey: Key;
  lastKey: Key;
  length: number;
}>;

type PrependScrollSnapshot = Readonly<{
  nextLength: number;
  scrollHeight: number;
  scrollTop: number;
}>;

export type ConversationVirtualListProps<TItem> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> &
  Readonly<{
    conversationId: string;
    estimateItemSize?: (item: TItem, index: number) => number;
    footer?: ReactNode;
    getItemKey: (item: TItem, index: number) => Key;
    header?: ReactNode;
    items: readonly TItem[];
    renderNavigation?: (
      navigateToItem: (index: number, anchorId: string) => void,
      scrollbarWidth: number,
      scrollContainerRef: RefObject<HTMLDivElement | null>,
    ) => ReactNode;
    renderItem: (item: TItem, index: number) => ReactNode;
    scrollToBottomSignal?: number;
  }>;

export function ConversationVirtualList<TItem>({
  className = "",
  conversationId,
  estimateItemSize,
  footer,
  getItemKey,
  header,
  items,
  onScroll,
  renderNavigation,
  renderItem,
  scrollToBottomSignal,
  style,
  ...props
}: ConversationVirtualListProps<TItem>) {
  const { t } = useTranslation("conversation");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentResizeObserverRef = useRef<ResizeObserver | null>(null);
  const navigationFrameRef = useRef(0);
  const prependCorrectionFrameRef = useRef(0);
  const lastObservedScrollTopRef = useRef(0);
  const committedItemBoundaryRef = useRef<ItemBoundary | null>(null);
  const prependScrollSnapshotRef = useRef<PrependScrollSnapshot | null>(null);
  const initialEndFollowRef = useRef(true);
  const pinnedToEndRef = useRef(true);
  const previousScrollToBottomSignalRef = useRef(scrollToBottomSignal);
  const [, commitColdJump] = useReducer((revision: number) => revision + 1, 0);
  const [atBottom, setAtBottom] = useState(true);
  const [initialScrolledConversationId, setInitialScrolledConversationId] = useState<string | null>(
    null,
  );
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const headerOffset = header === undefined ? 0 : 1;
  const footerOffset = footer === undefined ? 0 : 1;
  const count = headerOffset + items.length + footerOffset;
  const previousBoundary = committedItemBoundaryRef.current;
  const addedItemCount = previousBoundary === null ? 0 : items.length - previousBoundary.length;
  const scrollElementBeforeCommit = scrollContainerRef.current;
  if (
    previousBoundary !== null &&
    addedItemCount > 0 &&
    scrollElementBeforeCommit !== null &&
    Object.is(getItemKey(items[addedItemCount] as TItem, addedItemCount), previousBoundary.firstKey) &&
    Object.is(getItemKey(items[items.length - 1] as TItem, items.length - 1), previousBoundary.lastKey)
  ) {
    // 在 React 提交新历史前保存真实视口，供 Virtualizer 未同步 DOM 时做一次确定性校正。
    prependScrollSnapshotRef.current = {
      nextLength: items.length,
      scrollHeight: scrollElementBeforeCommit.scrollHeight,
      scrollTop: scrollElementBeforeCommit.scrollTop,
    };
  }
  const getVirtualKey = useCallback(
    (virtualIndex: number): string => {
      if (header !== undefined && virtualIndex === 0) return `${conversationId}:header`;
      const itemIndex = virtualIndex - headerOffset;
      if (itemIndex >= items.length) {
        // 追加 Turn 时复用待处理尾部及其测量缓存，避免重挂后退回估算高度。
        return `${conversationId}:footer`;
      }
      const itemKey = getItemKey(items[itemIndex] as TItem, itemIndex);
      return `${conversationId}:item:${typeof itemKey}:${String(itemKey)}`;
    },
    [conversationId, getItemKey, header, headerOffset, items],
  );
  const estimateSize = useCallback(
    (virtualIndex: number): number => {
      if (header !== undefined && virtualIndex === 0) return HEADER_ESTIMATED_HEIGHT_PX;
      const itemIndex = virtualIndex - headerOffset;
      if (itemIndex >= items.length) return FOOTER_ESTIMATED_HEIGHT_PX;
      return estimateItemSize?.(items[itemIndex] as TItem, itemIndex) ??
        DEFAULT_TURN_ESTIMATED_HEIGHT_PX;
    },
    [estimateItemSize, header, headerOffset, items],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    anchorTo: "end",
    count,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    estimateSize,
    followOnAppend: true,
    gap: TURN_GAP_PX,
    getItemKey: getVirtualKey,
    getScrollElement: () => scrollContainerRef.current,
    // RO 延迟到下一帧时，entry 可能早于同步提交；读取当前高度，避免回滚新尺寸。
    measureElement: (element) => element.offsetHeight,
    overscan: TURN_OVERSCAN,
    // 留白属于列表而非末行，追加消息时不能改变已测量历史行的高度。
    paddingEnd: VERTICAL_PADDING_PX,
    paddingStart: VERTICAL_PADDING_PX,
    scrollEndThreshold: SCROLL_END_THRESHOLD_PX,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    onChange: (instance) => {
      const nextAtBottom = instance.isAtEnd();
      setAtBottom((current) => (current === nextAtBottom ? current : nextAtBottom));
    },
  });
  const measureVirtualRow = useCallback(
    (element: HTMLDivElement | null) => {
      virtualizer.measureElement(element);
      if (element !== null) contentResizeObserverRef.current?.observe(element);
    },
    [virtualizer],
  );

  useLayoutEffect(() => {
    // Item 结构或尾部占位变化时，绘制前同步已挂载行；尾部可独立更新，不能只依赖估算函数。
    // 先批量读取再更新 Virtualizer，不扫描历史全文，也不参与普通文本 Delta。
    const measurements = Array.from(virtualizer.elementsCache.values(), (element) =>
      [virtualizer.indexFromElement(element), element.offsetHeight] as const,
    );
    for (const [index, height] of measurements) virtualizer.resizeItem(index, height);
    const viewport = scrollContainerRef.current;
    if (viewport && (initialEndFollowRef.current || pinnedToEndRef.current)) {
      // 同次提交完成真实高度和置底，不能等下一帧的 ResizeObserver 再将新输入上移。
      const content = viewport.querySelector<HTMLElement>("[data-virtual-container]");
      if (content) content.style.height = `${virtualizer.getTotalSize()}px`;
      virtualizer.scrollToOffset(viewport.scrollHeight - viewport.clientHeight);
    }
  }, [estimateSize, footer, virtualizer]);

  useLayoutEffect(() => {
    const snapshot = prependScrollSnapshotRef.current;
    if (snapshot?.nextLength === items.length) {
      cancelAnimationFrame(prependCorrectionFrameRef.current);
      prependCorrectionFrameRef.current = requestAnimationFrame(() => {
        const scrollElement = scrollContainerRef.current;
        if (scrollElement === null || prependScrollSnapshotRef.current !== snapshot) return;
        const targetOffset = snapshot.scrollTop + scrollElement.scrollHeight - snapshot.scrollHeight;
        if (Math.abs(scrollElement.scrollTop - targetOffset) >= 1) {
          // 等待虚拟容器提交最终高度后，只经 Virtualizer 校正浏览器位置。
          virtualizer.scrollToOffset(targetOffset, { behavior: "auto" });
        }
        lastObservedScrollTopRef.current = targetOffset;
        prependScrollSnapshotRef.current = null;
      });
    }
    committedItemBoundaryRef.current =
      items.length === 0
        ? null
        : {
            firstKey: getItemKey(items[0] as TItem, 0),
            lastKey: getItemKey(items[items.length - 1] as TItem, items.length - 1),
            length: items.length,
          };
  }, [getItemKey, items, virtualizer]);

  useLayoutEffect(() => {
    // 会话首次呈现时从最新 Turn 开始，后续追加和流式增长交给 end anchor。
    if (initialScrolledConversationId === conversationId) return;
    initialEndFollowRef.current = true;
    virtualizer.scrollToEnd();
    setInitialScrolledConversationId(conversationId);
    setAtBottom(true);
  }, [conversationId, initialScrolledConversationId, virtualizer]);
  useLayoutEffect(() => {
    if (
      scrollToBottomSignal === undefined ||
      scrollToBottomSignal === previousScrollToBottomSignalRef.current
    ) {
      return;
    }
    previousScrollToBottomSignalRef.current = scrollToBottomSignal;
    initialEndFollowRef.current = true;
    virtualizer.scrollToEnd();
  }, [scrollToBottomSignal, virtualizer]);
  useEffect(() => {
    const scrollElement = scrollContainerRef.current;
    if (scrollElement === null) return;
    let previousClientHeight = scrollElement.clientHeight;
    let previousScrollHeight = scrollElement.scrollHeight;
    let resizeTimer: number | null = null;
    const scheduleEndCorrection = () => {
      if (resizeTimer !== null) return;
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (initialEndFollowRef.current || pinnedToEndRef.current) {
          virtualizer.scrollToEnd();
          // 异步富文本仍按真实范围收敛，浏览器会将不足一屏的负偏移截为零。
          virtualizer.scrollToOffset(scrollElement.scrollHeight - scrollElement.clientHeight);
        }
      });
    };
    const syncViewportMetrics = () => {
      const nextWidth = Math.max(0, scrollElement.offsetWidth - scrollElement.clientWidth);
      setScrollbarWidth((current) => (current === nextWidth ? current : nextWidth));
      const clientHeightChanged = scrollElement.clientHeight !== previousClientHeight;
      const scrollHeightChanged = scrollElement.scrollHeight !== previousScrollHeight;
      if (!clientHeightChanged && !scrollHeightChanged) return;
      const shouldFollowEnd = initialEndFollowRef.current || pinnedToEndRef.current;
      previousClientHeight = scrollElement.clientHeight;
      previousScrollHeight = scrollElement.scrollHeight;
      if (shouldFollowEnd) {
        // 异步富文本或视口改变高度后，继续展示任务的最新位置。
        scheduleEndCorrection();
      }
    };
    const observer = new ResizeObserver(syncViewportMetrics);
    contentResizeObserverRef.current = observer;
    const commitWebKitColdJump = () => {
      const previousScrollTop = lastObservedScrollTopRef.current;
      lastObservedScrollTopRef.current = scrollElement.scrollTop;
      pinnedToEndRef.current =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <=
        SCROLL_END_THRESHOLD_PX;
      if (Math.abs(scrollElement.scrollTop - previousScrollTop) <= scrollElement.clientHeight * 2) {
        return;
      }
      const containerRect = scrollElement.getBoundingClientRect();
      const hasMountedRowInViewport = Array.from(
        scrollElement.querySelectorAll<HTMLElement>("[data-virtual-row]"),
      ).some((row) => {
        const rowRect = row.getBoundingClientRect();
        return rowRect.bottom > containerRect.top && rowRect.top < containerRect.bottom;
      });
      if (!hasMountedRowInViewport) {
        // TanStack 已在先注册的原生 listener 中计算新窗口，此处仅同步 WebKit 冷跳提交。
        flushSync(() => {
          commitColdJump();
        });
      }
    };
    const releaseInitialEndFollow = () => {
      // 仅明确的桌面滚动交互解除初始跟随，程序化测量滚动不得伪装成用户意图。
      initialEndFollowRef.current = false;
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
    };
    syncViewportMetrics();
    observer.observe(scrollElement);
    const contentElement = scrollElement.querySelector<HTMLElement>("[data-virtual-container]");
    if (contentElement !== null) observer.observe(contentElement);
    scrollElement
      .querySelectorAll<HTMLElement>("[data-virtual-row]")
      .forEach((element) => observer.observe(element));
    scheduleEndCorrection();
    scrollElement.addEventListener("keydown", releaseInitialEndFollow, true);
    scrollElement.addEventListener("pointerdown", releaseInitialEndFollow, true);
    scrollElement.addEventListener("scroll", commitWebKitColdJump, { passive: true });
    scrollElement.addEventListener("wheel", releaseInitialEndFollow, { passive: true });
    return () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      observer.disconnect();
      contentResizeObserverRef.current = null;
      scrollElement.removeEventListener("keydown", releaseInitialEndFollow, true);
      scrollElement.removeEventListener("pointerdown", releaseInitialEndFollow, true);
      scrollElement.removeEventListener("scroll", commitWebKitColdJump);
      scrollElement.removeEventListener("wheel", releaseInitialEndFollow);
    };
  }, [commitColdJump, virtualizer]);

  const navigateToItem = useCallback(
    (index: number, anchorId: string) => {
      if (index < 0 || index >= items.length) return;
      initialEndFollowRef.current = false;
      cancelAnimationFrame(navigationFrameRef.current);
      virtualizer.scrollToIndex(index + headerOffset, { align: "start", behavior: "auto" });
      navigationFrameRef.current = requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        const anchor = container
          ? Array.from(
              container.querySelectorAll<HTMLElement>("[data-conversation-anchor]"),
            ).find((element) => element.dataset["conversationAnchor"] === anchorId)
          : undefined;
        anchor?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    },
    [headerOffset, items.length, virtualizer],
  );
  useLayoutEffect(
    () => () => {
      cancelAnimationFrame(navigationFrameRef.current);
      cancelAnimationFrame(prependCorrectionFrameRef.current);
    },
    [],
  );

  return (
    <div
      className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
      onScroll={onScroll}
      ref={scrollContainerRef}
      role="log"
      data-scroll-restoration-id={`conversation:${conversationId}`}
      // 禁用浏览器原生锚定，避免与 Virtualizer 的 end anchor 重复修正滚动位置。
      style={{ ...style, overflowAnchor: "none" }}
      aria-live="off"
      {...props}
    >
      {renderNavigation?.(navigateToItem, scrollbarWidth, scrollContainerRef)}
      <div
        className="mx-auto w-full max-w-content px-4 sm:px-6"
        data-conversation-content=""
      >
        <div
          data-virtual-container=""
          ref={virtualizer.containerRef}
          style={{ position: "relative", width: "100%" }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const itemIndex = virtualItem.index - headerOffset;
            const isHeader = header !== undefined && virtualItem.index === 0;
            const isFooter = itemIndex >= items.length;
            return (
              <div
                data-conversation-turn={isHeader || isFooter ? undefined : ""}
                data-index={virtualItem.index}
                data-virtual-row={isHeader ? "header" : isFooter ? "footer" : "turn"}
                key={virtualItem.key}
                ref={measureVirtualRow}
                style={{ left: 0, position: "absolute", width: "100%" }}
              >
                {isHeader
                  ? header
                  : isFooter
                    ? <div className="space-y-6">{footer}</div>
                    : renderItem(items[itemIndex] as TItem, itemIndex)}
              </div>
            );
          })}
        </div>
      </div>
      {atBottom ? null : (
        // 悬浮按钮不参与滚动高度，避免显隐时产生 32px 的置底回弹。
        <div className="sticky bottom-3 z-10 h-0">
          <Button
            variant="ghost"
            className="absolute bottom-0 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-pill bg-raised shadow-floating"
            onClick={() => {
              virtualizer.scrollToEnd({ behavior: "smooth" });
            }}
            title={t("agentComponents.scrollToBottom")}
            type="button"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("agentComponents.scrollToBottom")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
