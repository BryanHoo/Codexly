import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils.js";

export function DrawerPortal(props: ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}
export function DrawerOverlay({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={(state) =>
        cn(
          "fixed inset-0 isolate z-50 bg-scrim opacity-[calc(1-var(--drawer-swipe-progress,0))] motion-safe:transition-opacity motion-safe:duration-180 data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:transition-none",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

/** 手势仲裁与浮层渲染单独成块，静态工作台只保留轻量控制器。 */
export default function DrawerSurface({
  modal,
  children,
  swipeHandle,
  closeButton,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Popup> & {
  modal: DrawerPrimitive.Root.Props["modal"];
  swipeHandle: ReactNode;
  closeButton: ReactNode;
}) {
  return (
    <DrawerPortal>
      {modal === true ? <DrawerOverlay /> : null}
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className={cn(
          "pointer-events-none fixed inset-0 z-50",
          modal === true && "pointer-events-auto",
        )}
      >
        <DrawerPrimitive.Popup data-slot="drawer-popup" {...props}>
          {swipeHandle}
          <DrawerPrimitive.Content
            data-slot="drawer-content"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-contain"
          >
            {children}
          </DrawerPrimitive.Content>
          {closeButton}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}
