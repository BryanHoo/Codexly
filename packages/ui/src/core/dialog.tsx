import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import {
  Children,
  createContext,
  useContext,
  useLayoutEffect,
  lazy,
  Suspense,
  useRef,
  type ComponentProps,
  type ReactElement,
} from "react";

import { cn } from "../lib/utils.js";
import { Button } from "./button.js";
import { dialogFocus } from "./dialog-focus.js";
import { dialogSurfaceClass, modalCloseClass } from "./modal-surface-styles.js";
import { useModalLazyLoad } from "./use-modal-lazy-load.js";

const loadDialogSurface = () => import("./dialog-surface.js");
const LazyDialogSurface = lazy(loadDialogSurface);
const LazyDialogPortal = lazy(() =>
  loadDialogSurface().then((module) => ({ default: module.DialogPortal })),
);
const LazyDialogOverlay = lazy(() =>
  loadDialogSurface().then((module) => ({ default: module.DialogOverlay })),
);

const DialogCloseContext = createContext(false);
const DialogModalContext = createContext(true);

interface DismissHandlers {
  closeDisabled?: boolean;
  onEscapeKeyDown?: ((event: Event) => void) | undefined;
  onPointerDownOutside?: ((event: Event) => void) | undefined;
  onInteractOutside?: ((event: Event) => void) | undefined;
}
const DialogDismissContext = createContext<{ current: DismissHandlers | null } | null>(null);
const DialogOpenContext = createContext(false);
const DialogLoadContext = createContext(false);

function Dialog({ onOpenChange, children, ...props }: DialogPrimitive.Root.Props) {
  const handlers = useRef<DismissHandlers | null>(null);
  const [shouldLoad, setLoaded] = useModalLazyLoad(props.open, props.defaultOpen);
  return (
    <DialogModalContext value={props.modal !== false}>
      <DialogLoadContext value={shouldLoad}>
        <DialogOpenContext value={props.open ?? props.defaultOpen ?? false}>
          <DialogDismissContext value={handlers}>
            <DialogPrimitive.Root
              {...props}
              onOpenChange={(open, details) => {
                if (!open) {
                  const current = handlers.current;
                  // 所有关闭原因统一经过提交保护；嵌套弹窗各自登记，不会拦截或关闭父层。
                  if (current?.closeDisabled) {
                    details.cancel();
                    return;
                  }
                  const event = new Event(details.reason, { cancelable: true });
                  if (details.reason === "escape-key") current?.onEscapeKeyDown?.(event);
                  if (details.reason === "outside-press") {
                    current?.onPointerDownOutside?.(event);
                    current?.onInteractOutside?.(event);
                  }
                  if (event.defaultPrevented) {
                    details.cancel();
                    return;
                  }
                }
                onOpenChange?.(open, details);
                if (open && !details.isCanceled) setLoaded(true);
              }}
            >
              {children}
            </DialogPrimitive.Root>
          </DialogDismissContext>
        </DialogOpenContext>
      </DialogLoadContext>
    </DialogModalContext>
  );
}

function DialogTrigger({
  asChild = false,
  children,
  render,
  ...props
}: ComponentProps<typeof DialogPrimitive.Trigger> & { asChild?: boolean }) {
  // 旧入口复用官方 render 合并事件与 ref，避免嵌套按钮；新增入口可直接使用 render。
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      render={asChild ? (Children.only(children) as ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Trigger>
  );
}

function DialogPortal({ children, ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
  const open = useContext(DialogOpenContext);
  const shouldLoad = useContext(DialogLoadContext);
  if (typeof document === "undefined") return open ? <>{children}</> : null;
  return shouldLoad ? (
    <Suspense fallback={null}>
      <LazyDialogPortal {...props}>{children}</LazyDialogPortal>
    </Suspense>
  ) : null;
}

function DialogClose({
  asChild = false,
  children,
  render,
  ...props
}: ComponentProps<typeof DialogPrimitive.Close> & { asChild?: boolean }) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      render={asChild ? (Children.only(children) as ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Close>
  );
}

function DialogOverlay(props: ComponentProps<typeof DialogPrimitive.Backdrop>) {
  const shouldLoad = useContext(DialogLoadContext);
  const modal = useContext(DialogModalContext);
  return shouldLoad && modal ? (
    <Suspense fallback={null}>
      <LazyDialogOverlay {...props} />
    </Suspense>
  ) : null;
}

function DialogContent({
  children,
  className,
  closeLabel,
  closeDisabled = false,
  showCloseButton = closeLabel !== undefined,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  initialFocus,
  finalFocus,
  style,
  render,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> &
  DismissHandlers &
  Readonly<{
    closeLabel?: string;
    showCloseButton?: boolean;
    onOpenAutoFocus?: ((event: Event) => void) | undefined;
    onCloseAutoFocus?: ((event: Event) => void) | undefined;
  }>) {
  const dismiss = useContext(DialogDismissContext);
  const shouldLoad = useContext(DialogLoadContext);
  const open = useContext(DialogOpenContext);
  const modal = useContext(DialogModalContext);
  useLayoutEffect(() => {
    if (!dismiss) return;
    const handlers = { closeDisabled, onEscapeKeyDown, onPointerDownOutside, onInteractOutside };
    dismiss.current = handlers;
    return () => {
      if (dismiss.current === handlers) dismiss.current = null;
    };
  }, [dismiss, closeDisabled, onEscapeKeyDown, onPointerDownOutside, onInteractOutside]);
  if (!shouldLoad) return null;
  // 关闭入口属于浮层，而非标题行；固定方形命中区域不会随长标题被压窄或拉高。
  const content = (
    <>
      <DialogCloseContext value={showCloseButton}>{children}</DialogCloseContext>
      {showCloseButton ? (
        <DialogClose
          disabled={closeDisabled}
          aria-label={closeLabel ?? "Close"}
          render={
            <Button type="button" variant="ghost" size="icon-compact" className={modalCloseClass} />
          }
        >
          <X aria-hidden="true" className="size-4" />
        </DialogClose>
      ) : null}
    </>
  );
  const surfaceClass = (state: DialogPrimitive.Popup.State) =>
    cn(dialogSurfaceClass, typeof className === "function" ? className(state) : className);
  if (typeof document === "undefined") {
    // 静态渲染不执行异步 Portal，仍保留现有语义正文测试；浏览器统一走原生浮层。
    if (!open) return null;
    const state: DialogPrimitive.Popup.State = {
      open: true,
      transitionStatus: "idle",
      nested: false,
      nestedDialogOpen: false,
    };
    return (
      <div
        role="dialog"
        aria-modal="true"
        data-slot="dialog-content"
        className={surfaceClass(state)}
        style={typeof style === "function" ? style(state) : style}
        {...props}
      >
        {content}
      </div>
    );
  }
  return (
    <Suspense fallback={null}>
      <LazyDialogSurface
        {...props}
        showOverlay={modal}
        className={surfaceClass}
        style={style}
        render={render}
        initialFocus={initialFocus ?? dialogFocus(onOpenAutoFocus)}
        finalFocus={finalFocus ?? dialogFocus(onCloseAutoFocus)}
      >
        {content}
      </LazyDialogSurface>
    </Suspense>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5 text-left", className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({
  className,
  asChild = false,
  children,
  render,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title> & { asChild?: boolean }) {
  const hasCloseButton = useContext(DialogCloseContext);
  return (
    <DialogPrimitive.Title
      className={(state) =>
        cn(
          "min-w-0 shrink-0 text-heading font-semibold leading-tight",
          hasCloseButton && "pe-10",
          typeof className === "function" ? className(state) : className,
        )
      }
      data-slot="dialog-title"
      render={asChild ? (Children.only(children) as ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Title>
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={(state) =>
        cn(
          "text-body-small text-muted-foreground",
          typeof className === "function" ? className(state) : className,
        )
      }
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
