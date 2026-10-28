// 基于 shadcn/ui Code Block（MIT）；复制与分批高亮由上层共享适配器提供，避免重复解析。
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
export function CodeBlock({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "destructive"; size?: "default" | "sm" }) {
  return (
    <div
      data-slot="code-block"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-surface border border-separator text-body-small text-foreground",
        variant === "destructive" && "border-danger/30 text-danger",
        size === "sm" && "text-label",
        className,
      )}
      {...props}
    />
  );
}
export function CodeBlockHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 px-3 pt-2 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function CodeBlockTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn("min-w-0 truncate text-label font-medium", className)}
      {...props}
    />
  );
}
export function CodeBlockActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}
export function CodeBlockContent({
  children,
  wrap = false,
  className,
  ...props
}: ComponentProps<"pre"> & { wrap?: boolean }) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      dir="ltr"
      tabIndex={0}
      className={cn(
        "min-h-0 min-w-0 overflow-auto p-3 text-start font-mono leading-relaxed outline-none focus-visible:shadow-focus",
        wrap && "whitespace-pre-wrap [overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    >
      <code data-slot="code-block-code" className="block min-w-0">
        {children}
      </code>
    </pre>
  );
}
