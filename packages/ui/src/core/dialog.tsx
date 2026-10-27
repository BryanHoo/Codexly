import * as DialogPrimitive from "radix-ui/dialog";
import { X } from "lucide-react";
import { createContext, useContext, type ComponentProps } from "react";

import { cn } from "../lib/utils.js";
import { Button } from "./button.js";

const DialogCloseContext = createContext<Readonly<{ label: string; disabled: boolean }> | null>(
  null,
);

function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ children, ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
  if (typeof document === "undefined") {
    // 当前组件测试使用 React SSR；浏览器运行时仍由 Radix Portal 承担焦点和层叠管理。
    return <>{children}</>;
  }
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal" {...props}>
      {children}
    </DialogPrimitive.Portal>
  );
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

function DialogContent({
  children,
  className,
  closeLabel,
  closeDisabled = false,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> &
  Readonly<{ closeLabel?: string; closeDisabled?: boolean }>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid min-w-0 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-surface bg-dialog p-5 text-foreground shadow-panel outline-none duration-180 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        data-slot="dialog-content"
        {...props}
      >
        <DialogCloseContext.Provider
          value={closeLabel === undefined ? null : { label: closeLabel, disabled: closeDisabled }}
        >
          {children}
        </DialogCloseContext.Provider>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 text-left", className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex justify-end gap-2", className)} data-slot="dialog-footer" {...props} />
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  const close = useContext(DialogCloseContext);
  const title = (
    <DialogPrimitive.Title
      className={cn(
        "min-w-0 text-heading font-semibold leading-tight",
        close !== null && "flex-1 leading-none",
        className,
      )}
      data-slot="dialog-title"
      {...props}
    />
  );
  if (close === null) return title;

  // 标题与悬停容器共用同一高度和上下边缘，X 保持原尺寸并在容器内部垂直居中。
  return (
    <div
      className="flex min-w-0 flex-1 items-stretch gap-3 text-heading leading-none"
      data-slot="dialog-title-row"
    >
      {title}
      <DialogClose asChild>
        <Button
          aria-label={close.label}
          className="w-[1em]"
          disabled={close.disabled}
          size="embedded"
          style={{ font: "inherit" }}
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </DialogClose>
    </div>
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-body-small text-muted-foreground", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
