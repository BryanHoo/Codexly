import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";

export function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}
export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={(state) =>
        cn(
          "fixed inset-0 isolate z-50 bg-scrim motion-safe:transition-opacity motion-safe:duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

/** 首次打开时才下载焦点圈定和 Portal 渲染层；关闭卸载及嵌套生命周期仍由 Base UI 管理。 */
export default function DialogSurface({
  showOverlay,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & { showOverlay: boolean }) {
  return (
    <DialogPortal>
      {showOverlay ? <DialogOverlay /> : null}
      <DialogPrimitive.Popup data-slot="dialog-content" {...props} />
    </DialogPortal>
  );
}
