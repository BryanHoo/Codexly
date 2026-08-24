import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ children, ...props }: ComponentProps<typeof SheetPrimitive.Portal>) {
  if (typeof document === "undefined") {
    // 组件测试使用 React SSR；浏览器运行时仍由 Radix 管理 Portal 与焦点圈定。
    return <>{children}</>;
  }
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal" {...props}>
      {children}
    </SheetPrimitive.Portal>
  );
}

function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      data-slot="sheet-overlay"
      {...props}
    />
  );
}

type SheetContentProps = ComponentProps<typeof SheetPrimitive.Content> &
  Readonly<{
    closeLabel?: string;
    showCloseButton?: boolean;
    side?: "bottom" | "left" | "right" | "top";
  }>;

function SheetContent({
  children,
  className,
  closeLabel = "Close",
  showCloseButton = true,
  side = "right",
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          "fixed z-50 flex min-w-0 flex-col gap-0 overflow-hidden bg-raised text-foreground shadow-panel outline-none duration-180 data-[state=closed]:animate-out data-[state=open]:animate-in",
          side === "right" &&
            "inset-y-0 right-0 h-dvh w-full border-l border-separator data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-[32rem]",
          side === "left" &&
            "inset-y-0 left-0 h-dvh w-full border-r border-separator data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-[32rem]",
          side === "top" &&
            "inset-x-0 top-0 max-h-dvh border-b border-separator data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-dvh border-t border-separator data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className,
        )}
        data-slot="sheet-content"
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close className="absolute right-3 top-3 inline-grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none">
            <X aria-hidden="true" />
            <span className="sr-only">{closeLabel}</span>
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 px-4 py-3", className)}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-auto flex items-center justify-end gap-2 px-4 py-3", className)}
      data-slot="sheet-footer"
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("text-heading font-semibold leading-tight", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn("text-body-small text-muted-foreground", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
