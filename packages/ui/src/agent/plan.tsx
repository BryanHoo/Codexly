import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceTitle,
  TraceDescription,
} from "../core/trace.js";
import { cn } from "../lib/utils.js";
const PlanContext = createContext(false);
export type PlanProps = ComponentProps<"div"> & {
  defaultOpen?: boolean;
  isStreaming?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
export function Plan({
  children,
  className,
  defaultOpen = false,
  isStreaming = false,
  open,
  onOpenChange,
  ...props
}: PlanProps) {
  const [expanded, setExpanded] = useState(defaultOpen);
  return (
    <PlanContext.Provider value={isStreaming}>
      <Trace
        className={className}
        data-ai-plan=""
        data-ai-plan-card=""
        data-streaming={isStreaming}
      >
        <TraceCollapsible
          open={open ?? expanded}
          onOpenChange={(value) => {
            setExpanded(value);
            onOpenChange?.(value);
          }}
          {...props}
        >
          {children}
        </TraceCollapsible>
      </Trace>
    </PlanContext.Provider>
  );
}
export function PlanHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <TraceCollapsibleTrigger className={cn("items-center", className)} {...props} />;
}
export function PlanTitle({
  className,
  ...props
}: Omit<HTMLAttributes<HTMLHeadingElement>, "children"> & { children: string }) {
  const streaming = useContext(PlanContext);
  return (
    <TraceTitle
      className={cn(
        "text-body-small font-medium",
        streaming && "agent-shimmer [--ui-shimmer-duration:2s] [--ui-shimmer-spread:2em]",
        className,
      )}
      {...props}
    />
  );
}
export function PlanDescription(
  props: Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & { children: string },
) {
  return <TraceDescription className="block whitespace-normal text-label leading-5" {...props} />;
}
// 官方折叠触发器统一提供箭头，此插槽只承载业务额外指示，避免重复图标。
export function PlanTrigger({ children }: { children?: ReactNode; className?: string }) {
  return children ?? null;
}
export function PlanContent(props: HTMLAttributes<HTMLDivElement>) {
  return <TraceCollapsibleContent {...props} />;
}
export function PlanFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-2 flex items-center", className)} {...props} />;
}
export function PlanAction(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
