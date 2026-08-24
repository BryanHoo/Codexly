import { Circle, CircleCheck, LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

export type QueueStatus = "pending" | "in_progress" | "completed";

export type QueueProps = ComponentProps<"div">;

export function Queue({ className = "", ...props }: QueueProps) {
  return <div className={cn(className)} data-ai-queue="" {...props} />;
}

export type QueueListProps = ComponentProps<"ul">;

export function QueueList({ className = "", ...props }: QueueListProps) {
  return <ul className={cn("space-y-0.5", className)} {...props} />;
}

export type QueueItemProps = ComponentProps<"li"> & {
  status: QueueStatus;
};

export function QueueItem({ className = "", status, ...props }: QueueItemProps) {
  return (
    <li
      className={cn(
        "grid min-h-8 grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-control-hover",
        className,
      )}
      data-status={status}
      {...props}
    />
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
  const icon =
    status === "completed" ? (
      <CircleCheck aria-hidden="true" className="size-3.5" />
    ) : status === "in_progress" ? (
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
    ) : (
      <Circle aria-hidden="true" className="size-3.5" />
    );

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
      {icon}
    </span>
  );
}

export type QueueItemContentProps = ComponentProps<"span"> & {
  status: QueueStatus;
};

export function QueueItemContent({ className = "", status, ...props }: QueueItemContentProps) {
  return (
    <span
      className={cn(
        "min-w-0 break-words text-label leading-5",
        status === "completed" ? "text-muted-foreground" : "text-foreground",
        className,
      )}
      {...props}
    />
  );
}
