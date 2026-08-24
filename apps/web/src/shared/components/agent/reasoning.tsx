import { BrainCircuit, ChevronRight, LoaderCircle } from "lucide-react";
import { createContext, useContext, useMemo, type HTMLAttributes } from "react";

import { cn } from "../../lib/utils.js";

type ReasoningContextValue = Readonly<{ isStreaming: boolean }>;

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export type ReasoningProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
  isStreaming?: boolean;
};

export function Reasoning({
  children,
  className,
  defaultOpen = false,
  isStreaming = false,
  ...props
}: ReasoningProps) {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

  return (
    <ReasoningContext.Provider value={contextValue}>
      <details
        className={cn("group/reasoning w-full text-muted-foreground", className)}
        data-ai-reasoning=""
        data-streaming={isStreaming}
        open={isStreaming || defaultOpen}
        {...props}
      >
        {children}
      </details>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = HTMLAttributes<HTMLElement> & {
  title: string;
};

export function ReasoningTrigger({ className, title, ...props }: ReasoningTriggerProps) {
  const context = useContext(ReasoningContext);
  if (context === null) {
    throw new Error("ReasoningTrigger must be used within Reasoning");
  }

  return (
    <summary
      className={cn(
        "flex min-h-9 cursor-pointer list-none items-center gap-2 py-1 text-label transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      {context.isStreaming ? (
        <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <BrainCircuit aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      <ChevronRight
        aria-hidden="true"
        className="size-3.5 shrink-0 transition-transform group-open/reasoning:rotate-90"
      />
    </summary>
  );
}

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement>;

export function ReasoningContent({ className, ...props }: ReasoningContentProps) {
  return (
    <div
      className={cn(
        "ml-1.5 border-l border-separator py-1 pl-4 text-body-small leading-6 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
