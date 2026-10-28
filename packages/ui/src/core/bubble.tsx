// 基于 shadcn/ui Bubble（MIT）；当前聊天只使用 muted 与 ghost，避免生成未使用的主题变体。
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
export function Bubble({
  align = "start",
  variant = "muted",
  className,
  ...props
}: ComponentProps<"div"> & { align?: "start" | "end"; variant?: "muted" | "ghost" }) {
  return (
    <div
      data-slot="bubble"
      data-align={align}
      data-variant={variant}
      className={cn(
        "group/bubble flex w-fit max-w-[80%] min-w-0 flex-col",
        align === "end" && "self-end",
        className,
      )}
      {...props}
    />
  );
}
export function BubbleContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        "w-fit max-w-full min-w-0 rounded-surface bg-control px-3 py-2 text-body-small leading-relaxed break-words group-data-[variant=ghost]/bubble:bg-transparent group-data-[variant=ghost]/bubble:p-0",
        className,
      )}
      {...props}
    />
  );
}
