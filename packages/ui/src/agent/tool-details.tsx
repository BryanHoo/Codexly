import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
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

export function ToolDetailsContent({ children }: { children: ReactNode }) {
  const details = useToolDetails();
  if (!details) return null;
  return (
    <DialogContent
      className="agent-operation-detail-dialog"
      closeLabel={details.closeLabel}
      aria-describedby={undefined}
    >
      <DialogTitle className="line-clamp-2 [overflow-wrap:anywhere]">{details.title}</DialogTitle>
      {/* Portal 脱离列表裁剪；内容按需挂载，关闭后卸载高亮和长日志。 */}
      <OperationDetailsContext.Provider value={null}>
        <ToolDetailsContext.Provider value={null}>
          <div className="agent-operation-detail-body" data-operation-detail-body="">
            {children}
          </div>
        </ToolDetailsContext.Provider>
      </OperationDetailsContext.Provider>
    </DialogContent>
  );
}
