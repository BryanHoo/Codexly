// 基于 shadcn/ui Message（MIT），使用项目字号与密度。
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
export function Message({
  align = "start",
  className,
  ...props
}: ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn("group/message relative flex w-full min-w-0 gap-2 text-body-small", className)}
      {...props}
    />
  );
}
export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn("flex w-full min-w-0 flex-col gap-2.5 break-words", className)}
      {...props}
    />
  );
}
export function MessageFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex max-w-full min-w-0 items-center text-label font-medium text-muted-foreground group-data-[align=end]/message:justify-end",
        className,
      )}
      {...props}
    />
  );
}
