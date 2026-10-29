import { AgentMotionProvider } from "./motion.js";
import { useConversationLayout } from "./conversation-anchor.js";
import { ConversationReadingSpace } from "./conversation-reading-space.js";
import {
  ConversationPromptProvider,
  ConversationStickyPrompt,
} from "./conversation-sticky-prompt.js";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
} from "../core/message-scroller.js";
import { cn } from "../lib/utils.js";

export type ConversationProps = HTMLAttributes<HTMLDivElement> & {
  conversationId: string;
  scrollToBottomSignal?: number;
  scrollLabel?: string;
  stickyPromptEnabled?: boolean;
};

const FollowActionContext = createContext<RefObject<() => void> | null>(null);
const PauseActionContext = createContext<RefObject<() => void> | null>(null);
const SubmissionSignalContext = createContext<number | undefined>(undefined);

/** 会话身份变化才重建滚动状态；流式增量不会重挂消息或重置用户阅读位置。 */
export function Conversation({
  conversationId,
  scrollToBottomSignal,
  scrollLabel,
  stickyPromptEnabled = false,
  children,
  className,
  style,
  ...props
}: ConversationProps) {
  const followAction = useRef<() => void>(() => undefined);
  const pauseAction = useRef<() => void>(() => undefined);
  const viewportRef = useRef<HTMLDivElement>(null);
  return (
    <MessageScrollerProvider
      key={conversationId}
      autoScroll
      defaultScrollPosition="end"
      scrollEdgeThreshold={24}
    >
      <AgentMotionProvider>
        <ConversationPromptProvider>
          <FollowActionContext.Provider value={followAction}>
            <PauseActionContext.Provider value={pauseAction}>
              <MessageScroller
                className={cn("flex-1", className)}
                style={{ ...style, overflow: "hidden" }}
              >
                <SubmissionSignalContext.Provider value={scrollToBottomSignal}>
                  <MessageScrollerViewport ref={viewportRef} {...props}>
                    {/* 关闭时卸载摘要及其监听；用户消息注册仍供发送定位与阅读留白复用。 */}
                    {stickyPromptEnabled ? (
                      <ConversationStickyPrompt
                        viewportRef={viewportRef}
                        pauseAction={pauseAction}
                      />
                    ) : null}
                    {children}
                  </MessageScrollerViewport>
                </SubmissionSignalContext.Provider>
                <ConversationReadingSpace viewportRef={viewportRef} signal={scrollToBottomSignal} />
                {scrollLabel === undefined ? null : (
                  <ConversationScrollButton label={scrollLabel} />
                )}
              </MessageScroller>
            </PauseActionContext.Provider>
          </FollowActionContext.Provider>
        </ConversationPromptProvider>
      </AgentMotionProvider>
    </MessageScrollerProvider>
  );
}

export function ConversationContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <MessageScrollerContent
      data-conversation-content=""
      className={cn(
        "mx-auto w-full max-w-content px-4 pt-6 pb-[var(--conversation-reading-space,1.5rem)] sm:px-6 sm:pt-7",
        className,
      )}
      {...props}
    />
  );
}

export type ConversationItemsProps<T> = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  items: readonly T[];
  getItemKey: (item: T, index: number) => Key;
  renderItem: (item: T, index: number) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  renderNavigation?: (
    navigate: (index: number, anchorId: string) => void,
    scrollbarWidth: number,
    container: RefObject<HTMLDivElement | null>,
  ) => ReactNode;
};

export function ConversationItems<T>({
  items,
  getItemKey,
  renderItem,
  renderNavigation,
  header,
  footer,
  ...props
}: ConversationItemsProps<T>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutActions = useConversationLayout(contentRef);
  const followAction = useContext(FollowActionContext);
  const pauseAction = useContext(PauseActionContext);
  useLayoutEffect(() => {
    if (followAction !== null)
      followAction.current = () => {
        layoutActions.current.follow();
      };
    if (pauseAction !== null)
      pauseAction.current = () => {
        layoutActions.current.pause();
      };
    return () => {
      if (followAction !== null) followAction.current = () => undefined;
      if (pauseAction !== null) pauseAction.current = () => undefined;
    };
  }, [followAction, pauseAction, layoutActions]);
  const submissionSignal = useContext(SubmissionSignalContext);
  useLayoutEffect(() => {
    layoutActions.current.follow();
  }, [submissionSignal, layoutActions]);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const hasNavigation = renderNavigation !== undefined;
  const { scrollToMessage } = useMessageScroller();
  useLayoutEffect(() => {
    containerRef.current =
      contentRef.current?.closest<HTMLDivElement>('[data-slot="message-scroller-viewport"]') ??
      null;
  }, []);
  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport || !hasNavigation) return;
    const sync = () => {
      setScrollbarWidth(Math.max(0, viewport.offsetWidth - viewport.clientWidth));
    };
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    sync();
    return () => {
      observer.disconnect();
    };
    // 导航工厂可以随父级更新；观察器只跟随入口的有无，避免每次更新反复退订与订阅。
  }, [hasNavigation]);
  const navigate = useCallback(
    (index: number, anchorId: string) => {
      const item = items[index];
      if (item === undefined) return;
      // 先通过官方命令解除跟随并定位回合，再定位其内部稳定锚点；真实 DOM 无需等待虚拟挂载。
      layoutActions.current.pause();
      scrollToMessage(String(getItemKey(item, index)), { behavior: "instant", align: "start" });
      const anchor = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>("[data-conversation-anchor]") ?? [],
      ).find((node) => node.dataset["conversationAnchor"] === anchorId);
      anchor?.scrollIntoView({ block: "start", behavior: "instant" });
    },
    [items, getItemKey, scrollToMessage, layoutActions],
  );
  // 页脚、发送信号和导航宽度变化只更新外围；复用上一版行元素，避免遍历全部已加载回合。
  // 这里只缓存当前列表的 React 元素，不卸载屏外正文，也不创建跨会话的行缓存。
  const rows = useMemo(
    () =>
      items.map((item, index) => (
        <MessageScrollerItem
          key={getItemKey(item, index)}
          messageId={String(getItemKey(item, index))}
          style={index >= items.length - 2 ? { contentVisibility: "visible" } : undefined}
          data-conversation-row="turn"
        >
          {renderItem(item, index)}
        </MessageScrollerItem>
      )),
    [items, getItemKey, renderItem],
  );
  return (
    <>
      {renderNavigation?.(navigate, scrollbarWidth, containerRef)}
      <ConversationContent ref={contentRef} {...props}>
        {header}
        {rows}
        {footer === undefined ? null : (
          <div className="space-y-6" data-conversation-row="footer">
            {footer}
          </div>
        )}
      </ConversationContent>
    </>
  );
}

export type ConversationListProps<T> = ConversationItemsProps<T> & {
  stickyPromptEnabled?: boolean;
  conversationId: string;
  scrollToBottomSignal?: number;
  scrollLabel: string;
};
export function ConversationList<T>({
  conversationId,
  scrollToBottomSignal,
  scrollLabel,
  stickyPromptEnabled = false,
  className,
  style,
  "aria-label": label,
  ...props
}: ConversationListProps<T>) {
  return (
    <Conversation
      scrollLabel={scrollLabel}
      stickyPromptEnabled={stickyPromptEnabled}
      conversationId={conversationId}
      {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
      {...(label === undefined ? {} : { "aria-label": label })}
      className={className}
      style={style}
    >
      <ConversationItems {...props} />
    </Conversation>
  );
}

export function ConversationScrollButton({
  label,
  onClick,
  ...props
}: React.ComponentProps<typeof MessageScrollerButton> & { label: string }) {
  const followAction = useContext(FollowActionContext);
  return (
    <MessageScrollerButton
      aria-label={label}
      title={label}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) followAction?.current();
      }}
      className="rounded-pill shadow-floating"
      {...props}
    />
  );
}
