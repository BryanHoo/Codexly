import { Trace, TraceLine, TraceTitle } from "../core/trace.js";
import { TraceStatusIcon } from "../core/trace-status.js";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";

export type QueueStatus = "pending" | "in_progress" | "completed";

export type QueueProps = ComponentProps<"div">;

export function Queue({ className = "", ...props }: QueueProps) {
  return <Trace className={className} data-ai-queue="" {...props} />;
}

export type QueueListProps = ComponentProps<"ul">;

export function QueueList({ className = "", ...props }: QueueListProps) {
  return <ul className={cn("space-y-0.5", className)} {...props} />;
}

export type QueueItemProps = ComponentProps<"li"> & {
  status: QueueStatus;
};

export function QueueItem({ children, className = "", status, ...props }: QueueItemProps) {
  return (
    <li className={cn("list-none", className)} data-status={status} {...props}>
      <TraceLine
        status={status === "in_progress" ? "running" : status === "pending" ? "pending" : undefined}
        className="items-start py-0.5"
      >
        {children}
      </TraceLine>
    </li>
  );
}

export type QueueItemIndicatorProps = Omit<ComponentProps<"span">, "children"> & {
  label: string;
  status: QueueStatus;
};

export function QueueItemIndicator({
  className = "",
  label,
  status,
  ...props
}: QueueItemIndicatorProps) {
  return (
    <span
      aria-label={label}
      className={cn(
        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center",
        status === "in_progress"
          ? "text-brand"
          : status === "completed"
            ? "text-muted-foreground"
            : "text-subtle-foreground",
        className,
      )}
      role="img"
      {...props}
    >
      <TraceStatusIcon status={status === "in_progress" ? "running" : status} />
    </span>
  );
}

export type QueueItemContentProps = ComponentProps<"span"> & {
  status: QueueStatus;
};

export function QueueItemContent({ className = "", status, ...props }: QueueItemContentProps) {
  return (
    <TraceTitle
      className={cn(
        "min-w-0 whitespace-normal break-words text-body-small leading-6",
        status === "completed" ? "text-muted-foreground" : "text-foreground",
        className,
      )}
      {...props}
    />
  );
}
