import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";
import { createConversationAutoScrollController } from "./conversation-scroll.js";

type ConversationProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    conversationId: string;
    scrollToBottomSignal?: number;
  }>;

type ConversationContentProps = HTMLAttributes<HTMLDivElement>;

type ConversationContextValue = Readonly<{
  atBottom: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  scrollbarWidth: number;
  scrollToBottom: () => void;
}>;

const ConversationContext = createContext<ConversationContextValue | null>(null);
const CONVERSATION_INITIAL_RECT = { height: 768, width: 1_024 };
const DEFAULT_TURN_ESTIMATED_HEIGHT_PX = 300;
const TURN_GAP_PX = 24;
const TURN_OVERSCAN = 3;

function useConversationContext(): ConversationContextValue {
  const context = useContext(ConversationContext);
  if (context === null) {
    throw new Error("Conversation virtual components must be used within Conversation");
  }
  return context;
}

export function Conversation({
  children,
  className = "",
  conversationId,
  onScroll,
  scrollToBottomSignal,
  style,
  ...props
}: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousScrollToBottomSignalRef = useRef(scrollToBottomSignal);
  const [atBottom, setAtBottom] = useState(true);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const autoScrollControllerRef = useRef<
    ReturnType<typeof createConversationAutoScrollController> | undefined
  >(undefined);
  const autoScrollController =
    autoScrollControllerRef.current ??
    (autoScrollControllerRef.current = createConversationAutoScrollController(setAtBottom));

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container !== null) {
      autoScrollController.scrollToBottom(container);
    }
  }, [autoScrollController]);
  const contextValue = useMemo(
    () => ({ atBottom, containerRef, scrollbarWidth, scrollToBottom }),
    [atBottom, scrollbarWidth, scrollToBottom],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // 先开启强制跟随，再等待长 Timeline 的延迟布局连续稳定后执行最终置底。
    autoScrollController.handleConversationChange(container);
    let previousScrollHeight = -1;
    let stableFrameCount = 0;
    let observedFrameCount = 0;
    let animationFrameId = 0;

    const settleConversationAtBottom = () => {
      autoScrollController.handleContentResize(container);
      const currentScrollHeight = container.scrollHeight;
      stableFrameCount = currentScrollHeight === previousScrollHeight ? stableFrameCount + 1 : 0;
      previousScrollHeight = currentScrollHeight;
      observedFrameCount += 1;

      // 连续两帧高度稳定即可视为消息布局完成；上限避免持续流式内容无限占用动画帧。
      if (stableFrameCount >= 2 || observedFrameCount >= 60) {
        autoScrollController.handleConversationRenderComplete(container);
        return;
      }
      animationFrameId = requestAnimationFrame(settleConversationAtBottom);
    };

    animationFrameId = requestAnimationFrame(settleConversationAtBottom);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [autoScrollController, conversationId]);

  useLayoutEffect(() => {
    if (
      scrollToBottomSignal === undefined ||
      scrollToBottomSignal === previousScrollToBottomSignalRef.current
    ) {
      return;
    }
    previousScrollToBottomSignalRef.current = scrollToBottomSignal;
    const container = containerRef.current;
    if (container !== null) {
      // 用户直接提交时恢复自动跟随，后续用户消息和流式回复继续保持在底部。
      autoScrollController.scrollToBottom(container);
    }
  }, [autoScrollController, scrollToBottomSignal]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const content =
      container.querySelector<HTMLElement>("[data-conversation-content]") ??
      container.firstElementChild;

    const syncScrollbarWidth = () => {
      const nextWidth = Math.max(0, container.offsetWidth - container.clientWidth);
      // 只在平台实际滚动条占位变化时更新，避免消息测量触发无意义重渲染。
      setScrollbarWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };
    const contentResizeObserver = new ResizeObserver(() => {
      syncScrollbarWidth();
      autoScrollController.handleContentResize(container);
    });
    syncScrollbarWidth();
    // Task 切换后消息内容与 Composer 可能分阶段完成布局，两侧尺寸变化都要重新校准到底部。
    contentResizeObserver.observe(container);
    if (content !== null) {
      contentResizeObserver.observe(content);
    }

    return () => {
      contentResizeObserver.disconnect();
    };
  }, [autoScrollController]);

  return (
    <ConversationContext.Provider value={contextValue}>
      <div
        className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
        onScroll={(event) => {
          const container = event.currentTarget;
          autoScrollController.handleScroll(container);
          onScroll?.(event);
        }}
        ref={containerRef}
        role="log"
        aria-live="off"
        style={{ ...style, overflowAnchor: "none" }}
        {...props}
      >
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({ className = "", ...props }: ConversationContentProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-content flex-col px-4 py-6 sm:px-6 sm:py-7 ${className}`}
      {...props}
    />
  );
}

export type ConversationVirtualListProps<TItem> = Omit<HTMLAttributes<HTMLDivElement>, "children"> &
  Readonly<{
    estimateSize?: (item: TItem, index: number) => number;
    footer?: ReactNode;
    getItemKey: (item: TItem, index: number) => Key;
    items: readonly TItem[];
    renderNavigation?: (
      navigateToItem: (index: number, anchorId: string) => void,
      scrollbarWidth: number,
      scrollContainerRef: RefObject<HTMLDivElement | null>,
    ) => ReactNode;
    renderItem: (item: TItem, index: number) => ReactNode;
  }>;

export function ConversationVirtualList<TItem>({
  className = "",
  estimateSize,
  footer,
  getItemKey,
  items,
  renderNavigation,
  renderItem,
  ...props
}: ConversationVirtualListProps<TItem>) {
  const context = useConversationContext();
  const navigationFrameRef = useRef(0);
  const getScrollElement = useCallback(() => context.containerRef.current, [context.containerRef]);
  const estimateTurnSize = useCallback(
    (index: number) =>
      estimateSize?.(items[index] as TItem, index) ?? DEFAULT_TURN_ESTIMATED_HEIGHT_PX,
    [estimateSize, items],
  );
  const getTurnKey = useCallback(
    (index: number) => getItemKey(items[index] as TItem, index),
    [getItemKey, items],
  );
  // Turn 是最小虚拟化边界；内部 项目 Agent 组件 保持完整挂载，由动态测量处理流式高度变化。
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    anchorTo: "end",
    count: items.length,
    estimateSize: estimateTurnSize,
    followOnAppend: "auto",
    gap: TURN_GAP_PX,
    getItemKey: getTurnKey,
    getScrollElement,
    initialRect: CONVERSATION_INITIAL_RECT,
    overscan: TURN_OVERSCAN,
    scrollEndThreshold: 24,
  });
  const navigateToItem = useCallback(
    (index: number, anchorId: string) => {
      const container = context.containerRef.current;
      if (container === null) {
        return;
      }
      cancelAnimationFrame(navigationFrameRef.current);

      const findAnchor = () =>
        Array.from(container.querySelectorAll<HTMLElement>("[data-conversation-anchor]")).find(
          (element) => element.dataset["conversationAnchor"] === anchorId,
        );
      const mountedAnchor = findAnchor();
      if (mountedAnchor !== undefined) {
        mountedAnchor.scrollIntoView({ block: "start" });
        return;
      }

      virtualizer.scrollToIndex(index, { align: "start" });
      let remainingFrames = 12;
      const finishNavigation = () => {
        const anchor = findAnchor();
        if (anchor !== undefined) {
          anchor.scrollIntoView({ block: "start" });
          return;
        }
        remainingFrames -= 1;
        if (remainingFrames > 0) {
          // 动态测高可能覆盖首次定位，目标锚点挂载前持续校准对应 Turn。
          virtualizer.scrollToIndex(index, { align: "start" });
          navigationFrameRef.current = requestAnimationFrame(finishNavigation);
        }
      };
      navigationFrameRef.current = requestAnimationFrame(finishNavigation);
    },
    [context.containerRef, virtualizer],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(navigationFrameRef.current);
    },
    [],
  );

  return (
    <>
      {renderNavigation?.(navigateToItem, context.scrollbarWidth, context.containerRef)}
      <div
        className={`mx-auto w-full max-w-content px-4 py-6 sm:px-6 sm:py-7 ${className}`}
        data-conversation-content=""
        {...props}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualTurn) => (
            <div
              className="absolute left-0 top-0 w-full"
              data-index={virtualTurn.index}
              key={virtualTurn.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${String(virtualTurn.start)}px)` }}
            >
              {renderItem(items[virtualTurn.index] as TItem, virtualTurn.index)}
            </div>
          ))}
        </div>
        {footer === undefined ? null : (
          <div className={items.length === 0 ? "space-y-6" : "mt-6 space-y-6"}>{footer}</div>
        )}
      </div>
    </>
  );
}

type ConversationScrollButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function ConversationScrollButton({
  className = "",
  onClick,
  type = "button",
  ...props
}: ConversationScrollButtonProps) {
  const context = useContext(ConversationContext);
  const { t } = useTranslation("conversation");

  if (context?.atBottom !== false) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      className={`sticky bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-pill bg-raised text-muted-foreground shadow-floating transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      title={t("agentComponents.scrollToBottom")}
      type={type}
      {...props}
      onClick={(event) => {
        context.scrollToBottom();
        onClick?.(event);
      }}
    >
      <ArrowDown className="size-4" aria-hidden="true" />
      <span className="sr-only">{t("agentComponents.scrollToBottom")}</span>
    </Button>
  );
}
