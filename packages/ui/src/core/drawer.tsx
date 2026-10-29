import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import {
  Children,
  createContext,
  useContext,
  useMemo,
  lazy,
  Suspense,
  type ReactNode,
  type ComponentProps,
  type ReactElement,
} from "react";

import { cn } from "../lib/utils.js";
import { dialogFocus } from "./dialog-focus.js";
import { drawerSurfaceClass, modalCloseClass } from "./modal-surface-styles.js";
import { Button } from "./button.js";
import { useModalLazyLoad } from "./use-modal-lazy-load.js";

const loadDrawerSurface = () => import("./drawer-surface.js");
const LazyDrawerSurface = lazy(loadDrawerSurface);
const LazyDrawerPortal = lazy(() =>
  loadDrawerSurface().then((module) => ({ default: module.DrawerPortal })),
);
const LazyDrawerOverlay = lazy(() =>
  loadDrawerSurface().then((module) => ({ default: module.DrawerOverlay })),
);

const DrawerContext = createContext<{
  modal: DrawerPrimitive.Root.Props["modal"];
  swipeDirection: NonNullable<DrawerPrimitive.Root.Props["swipeDirection"]>;
  open: boolean;
  showSwipeHandle: boolean;
  shouldLoad: boolean;
}>({
  modal: true,
  swipeDirection: "right",
  open: false,
  showSwipeHandle: false,
  shouldLoad: false,
});

function Drawer({
  modal = true,
  swipeDirection = "right",
  showSwipeHandle = false,
  onOpenChange,
  ...props
}: DrawerPrimitive.Root.Props & { showSwipeHandle?: boolean }) {
  const [shouldLoad, setLoaded] = useModalLazyLoad(props.open, props.defaultOpen);
  const value = useMemo(
    () => ({
      modal,
      swipeDirection,
      showSwipeHandle,
      shouldLoad,
      open: props.open ?? props.defaultOpen ?? false,
    }),
    [modal, swipeDirection, showSwipeHandle, shouldLoad, props.open, props.defaultOpen],
  );
  return (
    <DrawerContext value={value}>
      <DrawerPrimitive.Root
        modal={modal}
        swipeDirection={swipeDirection}
        {...props}
        onOpenChange={(open, details) => {
          onOpenChange?.(open, details);
          if (open && !details.isCanceled) setLoaded(true);
        }}
      />
    </DrawerContext>
  );
}

function DrawerTrigger({
  asChild = false,
  children,
  render,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Trigger> & { asChild?: boolean }) {
  return (
    <DrawerPrimitive.Trigger
      data-slot="drawer-trigger"
      render={asChild ? (Children.only(children) as ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </DrawerPrimitive.Trigger>
  );
}

function DrawerClose({
  asChild = false,
  children,
  render,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Close> & { asChild?: boolean }) {
  return (
    <DrawerPrimitive.Close
      data-slot="drawer-close"
      render={asChild ? (Children.only(children) as ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </DrawerPrimitive.Close>
  );
}

function DrawerPortal({ children, ...props }: ComponentProps<typeof DrawerPrimitive.Portal>) {
  const { open, shouldLoad } = useContext(DrawerContext);
  if (typeof document === "undefined") return open ? <>{children}</> : null;
  return shouldLoad ? (
    <Suspense fallback={null}>
      <LazyDrawerPortal {...props}>{children}</LazyDrawerPortal>
    </Suspense>
  ) : null;
}
function DrawerOverlay(props: ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  const { shouldLoad } = useContext(DrawerContext);
  return shouldLoad ? (
    <Suspense fallback={null}>
      <LazyDrawerOverlay {...props} />
    </Suspense>
  ) : null;
}

function DrawerContent({
  children,
  className,
  closeLabel = "Close",
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  initialFocus,
  finalFocus,
  style,
  render,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Popup> & {
  closeLabel?: string;
  showCloseButton?: boolean;
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}) {
  const { modal, swipeDirection, showSwipeHandle, shouldLoad, open } = useContext(DrawerContext);
  if (!shouldLoad) return null;
  const swipeHandle = showSwipeHandle ? <DrawerSwipeHandle /> : null;
  const closeButton: ReactNode = showCloseButton ? (
    <DrawerClose
      aria-label={closeLabel}
      render={
        <Button type="button" variant="ghost" size="icon-compact" className={modalCloseClass} />
      }
    >
      <X aria-hidden="true" className="size-4" />
    </DrawerClose>
  ) : null;
  const surfaceClass = (state: DrawerPrimitive.Popup.State) =>
    cn(
      drawerSurfaceClass(swipeDirection),
      typeof className === "function" ? className(state) : className,
    );
  if (typeof document === "undefined") {
    if (!open) return null;
    const state: DrawerPrimitive.Popup.State = {
      open: true,
      transitionStatus: "idle",
      expanded: false,
      nested: false,
      nestedDrawerOpen: false,
      nestedDrawerSwiping: false,
      swipeDirection,
      swiping: false,
    };
    return (
      <div data-slot="drawer-viewport">
        <div
          role="dialog"
          aria-modal="true"
          data-slot="drawer-popup"
          data-swipe-direction={swipeDirection}
          className={surfaceClass(state)}
          style={typeof style === "function" ? style(state) : style}
          {...props}
        >
          {swipeHandle}
          <div
            data-slot="drawer-content"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-contain"
          >
            {children}
          </div>
          {closeButton}
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={null}>
      <LazyDrawerSurface
        {...props}
        modal={modal}
        className={surfaceClass}
        style={style}
        render={render}
        swipeHandle={swipeHandle}
        closeButton={closeButton}
        initialFocus={initialFocus ?? dialogFocus(onOpenAutoFocus)}
        finalFocus={finalFocus ?? dialogFocus(onCloseAutoFocus)}
      >
        {children}
      </LazyDrawerSurface>
    </Suspense>
  );
}

function DrawerSwipeHandle({ className, ...props }: ComponentProps<"div">) {
  const { swipeDirection } = useContext(DrawerContext);
  const horizontal = swipeDirection === "left" || swipeDirection === "right";
  // 手柄放在 Content 之外，鼠标可拖动；正文仍可选择文本，触屏滚动交给原生手势仲裁。
  return (
    <div
      aria-hidden="true"
      data-slot="drawer-swipe-handle"
      className={cn(
        "absolute z-10 flex touch-none cursor-grab items-center justify-center select-none active:cursor-grabbing",
        horizontal ? "inset-y-0 w-3" : "inset-x-0 h-3",
        swipeDirection === "right" && "left-0",
        swipeDirection === "left" && "right-0",
        swipeDirection === "down" && "top-0",
        swipeDirection === "up" && "bottom-0",
        className,
      )}
      {...props}
    >
      <span
        className={cn("rounded-full bg-separator-strong", horizontal ? "h-8 w-1" : "h-1 w-8")}
      />
    </div>
  );
}

function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex shrink-0 flex-col gap-1.5 px-6 py-5 pe-16", className)}
      {...props}
    />
  );
}
function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex shrink-0 items-center justify-end gap-2 px-6 py-4", className)}
      {...props}
    />
  );
}
function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={(state) =>
        cn(
          "text-heading font-semibold leading-tight",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}
function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={(state) =>
        cn(
          "text-body-small text-muted-foreground",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerSwipeHandle,
};
