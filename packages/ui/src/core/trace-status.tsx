import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock3,
  LoaderCircle,
} from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/utils.js";

export type TraceStatus =
  "running" | "completed" | "error" | "pending" | "denied" | "waiting" | "responded";

/** 状态由图标表达，文字语义交给触发器的 accessible name，避免每行重复占用标题。 */
export function TraceStatusIcon({
  status,
  fallback,
  className,
}: {
  status?: TraceStatus | undefined;
  fallback?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(status);
  useLayoutEffect(() => {
    const changed = previous.current !== status;
    previous.current = status;
    if (
      !changed ||
      !ref.current?.animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = ref.current.animate(
      [
        { opacity: 0.35, transform: "scale(.82)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 180, easing: "cubic-bezier(.16,1,.3,1)", id: "trace-status" },
    );
    return () => {
      animation.cancel();
    };
  }, [status]);
  const icon =
    status === "running" ? (
      <LoaderCircle className="motion-safe:animate-spin" />
    ) : status === "completed" ? (
      <CircleCheck />
    ) : status === "error" ? (
      <CircleAlert />
    ) : status === "denied" ? (
      <CircleX />
    ) : status === "waiting" ? (
      <Clock3 />
    ) : status === "responded" ? (
      <Check />
    ) : status === "pending" ? (
      <CircleDashed />
    ) : (
      fallback
    );
  return (
    <span
      ref={ref}
      data-slot="trace-status-icon"
      data-status={status}
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4",
        status === "error" && "text-danger",
        (status === "waiting" || status === "denied") && "text-warning",
        className,
      )}
    >
      {icon}
    </span>
  );
}
