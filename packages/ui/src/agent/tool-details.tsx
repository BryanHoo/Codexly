import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
  type ReactNode,
} from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../core/dialog.js";
import { Trace, TraceIcon } from "../core/trace.js";
import { cn } from "../lib/utils.js";

type DetailPresentation = Readonly<{ closeLabel: string; onOpen?: () => void }>;
export const OperationDetailsContext = createContext<DetailPresentation | null>(null);
const ToolDetailsContext = createContext<Readonly<{
  closeLabel: string;
  title: string;
  setTitle: (title: string) => void;
}> | null>(null);

/** 仅五行操作列表启用独立详情，组外 Tool 保留原有折叠行为。 */
export function OperationDetailsProvider({
  children,
  closeLabel,
  onOpen,
}: DetailPresentation & { children: ReactNode }) {
  const value = useMemo(
    () => ({ closeLabel, ...(onOpen ? { onOpen } : {}) }),
    [closeLabel, onOpen],
  );
  return (
    <OperationDetailsContext.Provider value={value}>{children}</OperationDetailsContext.Provider>
  );
}

export function ToolDetails({
  children,
  className,
  presentation,
  ...props
}: ComponentProps<"div"> & { presentation: DetailPresentation }) {
  const [title, setTitle] = useState("");
  const value = useMemo(
    () => ({ title, setTitle, closeLabel: presentation.closeLabel }),
    [title, presentation.closeLabel],
  );
  return (
    <ToolDetailsContext.Provider value={value}>
      {/* 不继承 isStreaming/defaultOpen，日志到达永远不能自动打开模态窗口。 */}
      <Dialog
        onOpenChange={(open) => {
          if (open) presentation.onOpen?.();
        }}
      >
        <Trace className={className}>
          <div className="min-w-0" {...props}>
            {children}
          </div>
        </Trace>
      </Dialog>
    </ToolDetailsContext.Provider>
  );
}

export function useToolDetails() {
  return useContext(ToolDetailsContext);
}

export function ToolDetailsTrigger({ children, className, ...props }: ComponentProps<"button">) {
  return (
    <DialogTrigger
      className={cn(
        "agent-trace-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-control text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-brand/50",
        className,
      )}
      {...props}
    >
      {children}
      <TraceIcon className="text-subtle-foreground">
        <ChevronRightIcon aria-hidden="true" />
      </TraceIcon>
    </DialogTrigger>
  );
}

/** 正文独立跟随，ResizeObserver 合并布局更新；滚动位置不进入 React 状态。 */
function ToolDetailsViewport({
  children,
  followOutput,
  viewportRef,
  label,
}: {
  children: ReactNode;
  followOutput: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!followOutput || !viewport || !content) return;
    const sync = () => {
      if (!following.current) return;
      // 只写弹窗自己的 scrollTop，不使用会牵动外层会话的 scrollIntoView。
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      previousTop.current = viewport.scrollTop;
    };
    const observer = new ResizeObserver(sync);
    observer.observe(content);
    observer.observe(viewport);
    sync();
    return () => {
      observer.disconnect();
    };
  }, [followOutput, viewportRef]);

  const pause = () => {
    following.current = false;
  };
  return (
    <div
      className="agent-operation-detail-body"
      data-operation-detail-body=""
      ref={viewportRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      onWheel={(event) => {
        if (event.deltaY < 0) pause();
      }}
      onTouchMove={pause}
      onPointerDown={pause}
      onClickCapture={(event) => {
        // 点击记录或加载历史时让读者接管，键盘触发按钮也遵循相同规则。
        if (event.target instanceof Element && event.target.closest("button, a")) pause();
      }}
      onKeyDown={(event) => {
        if (
          ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
          (event.key === " " && event.shiftKey)
        )
          pause();
      }}
      onScroll={() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        // 手动回到底部恢复跟随；向上拖动滚动条也会暂停，不依赖滚轮事件。
        if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1)
          following.current = true;
        else if (viewport.scrollTop < previousTop.current - 1) pause();
        previousTop.current = viewport.scrollTop;
      }}
    >
      <div className="min-w-0 flow-root" ref={contentRef}>
        {children}
      </div>
    </div>
  );
}

/** 时间线操作与右栏子代理共享同一弹窗及正文跟随生命周期。 */
export function OperationDetailsDialogContent({
  children,
  followOutput = false,
  title,
  closeLabel,
  className,
  ...props
}: Omit<ComponentProps<typeof DialogContent>, "title"> & {
  title: string;
  closeLabel: string;
  followOutput?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  return (
    <DialogContent
      {...props}
      className={cn("agent-operation-detail-dialog", className)}
      closeLabel={closeLabel}
      aria-describedby={undefined}
      onOpenAutoFocus={
        followOutput
          ? (event) => {
              // 初始聚焦正文而非首条按钮，避免焦点把底部跟随拉回开头。
              event.preventDefault();
              viewportRef.current?.focus({ preventScroll: true });
            }
          : props.onOpenAutoFocus
      }
    >
      <DialogTitle className="line-clamp-2 [overflow-wrap:anywhere]">{title}</DialogTitle>
      <OperationDetailsContext.Provider value={null}>
        <ToolDetailsContext.Provider value={null}>
          <ToolDetailsViewport followOutput={followOutput} viewportRef={viewportRef} label={title}>
            {children}
          </ToolDetailsViewport>
        </ToolDetailsContext.Provider>
      </OperationDetailsContext.Provider>
    </DialogContent>
  );
}

export function ToolDetailsContent({
  children,
  followOutput = false,
}: {
  children: ReactNode;
  followOutput?: boolean;
}) {
  const details = useToolDetails();
  return details ? (
    <OperationDetailsDialogContent
      title={details.title}
      closeLabel={details.closeLabel}
      followOutput={followOutput}
    >
      {children}
    </OperationDetailsDialogContent>
  ) : null;
}
