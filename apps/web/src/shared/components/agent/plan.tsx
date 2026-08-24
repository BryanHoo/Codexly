import { ChevronsUpDown } from "lucide-react";
import { createContext, useContext, useMemo, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/utils.js";

type PlanContextValue = Readonly<{
  isStreaming: boolean;
}>;

const PlanContext = createContext<PlanContextValue | null>(null);

export type PlanProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
  isStreaming?: boolean;
  open?: boolean;
};

export function Plan({
  children,
  className = "",
  defaultOpen,
  isStreaming = false,
  open,
  ...props
}: PlanProps) {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

  return (
    <PlanContext.Provider value={contextValue}>
      <details
        className={cn(
          "group/plan w-full overflow-hidden rounded-surface border border-separator bg-panel",
          className,
        )}
        data-ai-plan=""
        data-ai-plan-card=""
        data-streaming={isStreaming}
        open={open ?? defaultOpen}
        {...props}
      >
        {children}
      </details>
    </PlanContext.Provider>
  );
}

export type PlanHeaderProps = HTMLAttributes<HTMLElement>;

export function PlanHeader({ className = "", ...props }: PlanHeaderProps) {
  return (
    <summary
      className={cn(
        "flex min-h-14 cursor-pointer list-none items-start gap-4 px-4 py-3.5 text-foreground transition-colors hover:bg-control-hover/45 [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export type PlanTitleProps = Omit<HTMLAttributes<HTMLHeadingElement>, "children"> & {
  children: string;
};

export function PlanTitle({ children, className = "", ...props }: PlanTitleProps) {
  const context = useContext(PlanContext);

  return (
    <h3
      className={`text-body-small font-semibold ${context?.isStreaming === true ? "animate-pulse" : ""} ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
}

export type PlanDescriptionProps = Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & {
  children: string;
};

export function PlanDescription({ children, className = "", ...props }: PlanDescriptionProps) {
  const context = useContext(PlanContext);

  return (
    <p
      className={`mt-1 text-body-small leading-5 text-muted-foreground ${context?.isStreaming === true ? "animate-pulse" : ""} ${className}`}
      {...props}
    >
      {children}
    </p>
  );
}

export type PlanTriggerProps = HTMLAttributes<HTMLSpanElement> & {
  children?: ReactNode;
};

export function PlanTrigger({ children, className = "", ...props }: PlanTriggerProps) {
  return (
    <span
      aria-hidden="true"
      className={`ml-auto inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground ${className}`}
      {...props}
    >
      {children ?? <ChevronsUpDown className="size-4" />}
    </span>
  );
}

export type PlanContentProps = HTMLAttributes<HTMLDivElement>;

export function PlanContent({ className = "", ...props }: PlanContentProps) {
  return (
    <div
      className={cn("overflow-x-auto border-t border-separator px-4 py-4", className)}
      {...props}
    />
  );
}

export type PlanFooterProps = HTMLAttributes<HTMLDivElement>;

export function PlanFooter({ className = "", ...props }: PlanFooterProps) {
  return <div className={cn("flex items-center px-4 pb-4", className)} {...props} />;
}

export type PlanActionProps = HTMLAttributes<HTMLDivElement>;

export function PlanAction({ className = "", ...props }: PlanActionProps) {
  return <div className={cn("flex items-center", className)} {...props} />;
}
