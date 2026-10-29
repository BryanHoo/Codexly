import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Children, createContext, useContext, type ReactElement, type RefAttributes } from "react";

import { cn } from "../lib/utils.js";

// 仅为已有 Root.delayDuration 调用传递局部延迟，不另建 Provider，保留全局快速切换分组。
const TooltipDelayContext = createContext<number | undefined>(undefined);

type TooltipProviderProps = TooltipPrimitive.Provider.Props & {
  delayDuration?: number;
  skipDelayDuration?: number;
};

function TooltipProvider({
  delayDuration = 350,
  skipDelayDuration = 150,
  delay = delayDuration,
  timeout = skipDelayDuration,
  ...props
}: TooltipProviderProps) {
  return <TooltipPrimitive.Provider delay={delay} timeout={timeout} {...props} />;
}

type TooltipProps = TooltipPrimitive.Root.Props & {
  delayDuration?: number;
};

function Tooltip({ delayDuration, ...props }: TooltipProps) {
  const root = <TooltipPrimitive.Root {...props} />;
  return delayDuration === undefined ? (
    root
  ) : (
    <TooltipDelayContext value={delayDuration}>{root}</TooltipDelayContext>
  );
}

type TooltipTriggerProps = TooltipPrimitive.Trigger.Props &
  RefAttributes<HTMLElement> & {
    asChild?: boolean;
  };

function TooltipTrigger({
  asChild = false,
  children,
  delay,
  render,
  ...props
}: TooltipTriggerProps) {
  const localDelay = useContext(TooltipDelayContext);
  // 旧 asChild 直接映射官方 render，事件与 ref 由 Base UI 合并，不增加 DOM 或重复克隆。
  const trigger = asChild ? (Children.only(children) as ReactElement) : render;
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      delay={delay ?? localDelay}
      render={trigger}
      {...props}
    >
      {asChild ? undefined : children}
    </TooltipPrimitive.Trigger>
  );
}

type TooltipContentProps = TooltipPrimitive.Popup.Props &
  RefAttributes<HTMLDivElement> &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionPadding" | "collisionBoundary"
  >;

function TooltipContent({
  children,
  className,
  align = "center",
  alignOffset = 0,
  collisionBoundary,
  collisionPadding = 8,
  side = "top",
  sideOffset = 8,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      {/* 定位层承担视口避让；浮层通过 Portal 脱离两端滚动容器的裁剪。 */}
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={(state) =>
            cn(
              "z-50 w-fit max-w-[min(20rem,calc(100vw-1rem))] origin-(--transform-origin) whitespace-normal wrap-anywhere rounded-control bg-foreground px-2 py-1 text-meta text-raised shadow-floating motion-safe:transition-[transform,opacity] motion-safe:duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none",
              typeof className === "function" ? className(state) : className,
            )
          }
          data-slot="tooltip-content"
          role="tooltip"
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow
            className="size-2 rotate-45 rounded-[2px] bg-inherit data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1"
            data-slot="tooltip-arrow"
          />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
