import * as DropdownMenuPrimitive from "radix-ui/dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuSub(props: ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuPortal({
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  if (typeof document === "undefined") {
    // SSR 测试没有 document，直接渲染子节点；浏览器中仍由 Radix Portal 脱离裁剪容器。
    return <>{children}</>;
  }
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props}>
      {children}
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuContent({
  children,
  className,
  collisionPadding = 8,
  sideOffset = 2,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "z-50 min-w-32 overflow-hidden rounded-surface bg-raised p-1 text-foreground shadow-floating outline-none",
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-control px-2 py-1.5 text-body-small outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-control-hover [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="dropdown-menu-item"
      {...props}
    />
  );
}

function DropdownMenuSubTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-control px-2 py-1.5 text-body-small outline-none transition-colors data-[state=open]:bg-control-hover data-[highlighted]:bg-control-hover [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  children,
  className,
  collisionPadding = 8,
  sideOffset = 2,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.SubContent
        className={cn(
          "z-50 min-w-40 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-surface bg-raised p-1 text-foreground shadow-floating outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-sub-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPortal>
  );
}

function DropdownMenuGroup(props: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1 text-label font-medium text-foreground", className)}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-separator", className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

function DropdownMenuRadioGroup(props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  children,
  className,
  indicator = "radio",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  indicator?: "check" | "radio";
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "relative flex cursor-default select-none items-center gap-2.5 rounded-control py-1.5 text-body-small outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-control-hover [&_svg]:pointer-events-none [&_svg]:shrink-0",
        indicator === "check" ? "pl-2 pr-8" : "pl-8 pr-2",
        className,
      )}
      data-indicator={indicator}
      data-indicator-position={indicator === "check" ? "end" : "start"}
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none absolute flex size-3.5 items-center justify-center",
          indicator === "check" ? "right-2" : "left-2",
        )}
      >
        <DropdownMenuPrimitive.ItemIndicator>
          {indicator === "check" ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Circle aria-hidden="true" className="size-2 fill-current text-brand" />
          )}
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
