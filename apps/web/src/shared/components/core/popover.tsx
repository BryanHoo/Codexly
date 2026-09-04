import * as PopoverPrimitive from "radix-ui/popover";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  align = "start",
  children,
  className,
  collisionPadding = 8,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const content = (
    <PopoverPrimitive.Content
      align={align}
      className={cn(
        "z-50 rounded-surface border border-separator-strong bg-raised text-foreground shadow-floating outline-none",
        className,
      )}
      collisionPadding={collisionPadding}
      data-slot="popover-content"
      sideOffset={sideOffset}
      {...props}
    >
      {children}
    </PopoverPrimitive.Content>
  );
  // SSR 测试中没有 Portal 容器，直接渲染内容即可。
  return typeof document === "undefined" ? (
    content
  ) : (
    <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
