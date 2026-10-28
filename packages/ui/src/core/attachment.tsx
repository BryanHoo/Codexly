// 基于 shadcn/ui Attachment（MIT），保留文件卡片的组合插槽与状态。
import type { ComponentProps } from "react";
import { Button } from "./button.js";
import { cn } from "../lib/utils.js";
export function Attachment({
  className,
  size = "xs",
  ...props
}: ComponentProps<"div"> & { size?: "xs" | "sm" | "default" }) {
  return (
    <div
      data-slot="attachment"
      data-state="done"
      data-size={size}
      className={cn(
        "group/attachment relative flex w-fit max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-control border border-separator bg-panel p-1 text-label text-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function AttachmentMedia({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-media"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-control bg-control",
        className,
      )}
      {...props}
    />
  );
}
export function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("min-w-0 flex-1 leading-tight", className)}
      {...props}
    />
  );
}
export function AttachmentTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn("block truncate font-medium", className)}
      {...props}
    />
  );
}
export function AttachmentDescription({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn("block truncate text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}
export function AttachmentAction({
  size = "icon-toolbar",
  variant = "ghost",
  ...props
}: ComponentProps<typeof Button>) {
  return <Button data-slot="attachment-action" size={size} variant={variant} {...props} />;
}
