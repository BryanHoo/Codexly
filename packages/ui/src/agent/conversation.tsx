import { AgentMotionProvider } from "./motion.js";
import { useConversationLayout } from "./conversation-anchor.js";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
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
};

const FollowActionContext = createContext<RefObject<() => void> | null>(null);
const SubmissionSignalContext = createContext<number | undefined>(undefined);

/** 会话身份变化才重建滚动状态；流式增量不会重挂消息或重置用户阅读位置。 */
export function Conversation({
  conversationId,
  scrollToBottomSignal,
  scrollLabel,
  children,
  className,
  style,
  ...props
}: ConversationProps) {
  const followAction = useRef<() => void>(() => undefined);
  return (
    <MessageScrollerProvider
      key={conversationId}
      autoScroll
      defaultScrollPosition="end"
      scrollEdgeThreshold={24}
    >
      <AgentMotionProvider>
        <FollowActionContext.Provider value={followAction}>
          <MessageScroller
            className={cn("flex-1", className)}
            style={{ ...style, overflow: "hidden" }}
          >
            <SubmissionSignalContext.Provider value={scrollToBottomSignal}>
              <MessageScrollerViewport {...props}>{children}</MessageScrollerViewport>
            </SubmissionSignalContext.Provider>
            <SubmissionScroll signal={scrollToBottomSignal} />
            {scrollLabel === undefined ? null : <ConversationScrollButton label={scrollLabel} />}
          </MessageScroller>
        </FollowActionContext.Provider>
      </AgentMotionProvider>
    </MessageScrollerProvider>
  );
}

function SubmissionScroll({ signal }: { signal: number | undefined }) {
  const { scrollToEnd } = useMessageScroller();
  const previous = useRef(signal);
  useLayoutEffect(() => {
    if (signal === undefined || signal === previous.current) return;
    previous.current = signal;
    // 只有用户主动发送才恢复跟随；历史加载与后台事件不能抢走阅读位置。
    scrollToEnd({ behavior: "instant" });
  }, [signal, scrollToEnd]);
  return null;
}

export function ConversationContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <MessageScrollerContent
      data-conversation-content=""
      className={cn("mx-auto w-full max-w-content px-4 py-6 sm:px-6 sm:py-7", className)}
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
  useLayoutEffect(() => {
    if (followAction !== null)
      followAction.current = () => {
        layoutActions.current.follow();
      };
    return () => {
      if (followAction !== null) followAction.current = () => undefined;
    };
  }, [followAction, layoutActions]);
  const submissionSignal = useContext(SubmissionSignalContext);
  useLayoutEffect(() => {
    layoutActions.current.follow();
  }, [submissionSignal, layoutActions]);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const { scrollToMessage } = useMessageScroller();
  useLayoutEffect(() => {
    containerRef.current =
      contentRef.current?.closest<HTMLDivElement>('[data-slot="message-scroller-viewport"]') ??
      null;
  }, []);
  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport || !renderNavigation) return;
    const sync = () => {
      setScrollbarWidth(Math.max(0, viewport.offsetWidth - viewport.clientWidth));
    };
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    sync();
    return () => {
      observer.disconnect();
    };
  }, [renderNavigation]);
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
  return (
    <>
      {renderNavigation?.(navigate, scrollbarWidth, containerRef)}
      <ConversationContent ref={contentRef} {...props}>
        {header}
        {items.map((item, index) => (
          <MessageScrollerItem
            key={getItemKey(item, index)}
            messageId={String(getItemKey(item, index))}
            style={index >= items.length - 2 ? { contentVisibility: "visible" } : undefined}
            data-conversation-row="turn"
          >
            {renderItem(item, index)}
          </MessageScrollerItem>
        ))}
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
  conversationId: string;
  scrollToBottomSignal?: number;
  scrollLabel: string;
};
export function ConversationList<T>({
  conversationId,
  scrollToBottomSignal,
  scrollLabel,
  className,
  style,
  "aria-label": label,
  ...props
}: ConversationListProps<T>) {
  return (
    <Conversation
      scrollLabel={scrollLabel}
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
