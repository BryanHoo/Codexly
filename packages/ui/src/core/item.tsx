// 基于 shadcn/ui Item（MIT），审批仅需要边框项、标题与动作区。
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
export function Item({
  className,
  variant = "outline",
  size = "sm",
  ...props
}: ComponentProps<"div"> & { variant?: "outline"; size?: "sm" }) {
  return (
    <div
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/item flex w-full min-w-0 flex-wrap items-center gap-2 rounded-surface border border-separator bg-panel p-3 text-label",
        className,
      )}
      {...props}
    />
  );
}
export function ItemTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("flex items-center gap-2 font-medium", className)}
      {...props}
    />
  );
}
export function ItemActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}
