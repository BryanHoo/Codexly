import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui/slot";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control text-body-small outline-none transition-colors focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      contentAlign: "center",
      size: "default",
      variant: "default",
    },
    variants: {
      contentAlign: {
        center: "justify-center",
        start: "justify-start text-left",
      },
      size: {
        compact: "h-8 px-3 text-label",
        default: "h-8 px-3",
        embedded: "h-auto p-0",
        sm: "h-7 px-2 text-label max-workbench:h-11",
        toolbar: "h-6 px-2 text-label max-workbench:h-11 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-body",
        icon: "inline-grid size-9 place-items-center px-0 max-workbench:size-11",
        "icon-compact": "inline-grid size-8 place-items-center px-0 max-workbench:size-11",
        "icon-sm":
          "inline-grid size-7 place-items-center px-0 max-workbench:size-11 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-toolbar":
          "inline-grid size-6 place-items-center px-0 max-workbench:size-11 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "inline-grid size-10 place-items-center px-0 max-workbench:size-11",
      },
      variant: {
        default: "bg-brand font-medium text-white hover:bg-brand-strong",
        destructive: "bg-danger font-medium text-white hover:opacity-90",
        embedded:
          "rounded-none bg-transparent text-inherit hover:bg-transparent hover:text-inherit focus-visible:shadow-none",
        ghost: "bg-transparent text-muted-foreground hover:bg-control-hover hover:text-foreground",
        inverse:
          "rounded-pill bg-foreground text-raised hover:bg-brand-strong disabled:bg-control-active disabled:text-muted-foreground",
        link: "h-auto px-0 text-brand underline-offset-4 hover:text-brand-strong hover:underline [&_svg:not([class*='size-'])]:size-3.5",
        outline:
          "border border-separator-strong bg-panel text-foreground hover:bg-control-hover hover:text-foreground",
        secondary: "bg-raised text-foreground shadow-sm hover:bg-control-hover",
      },
    },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  asChild = false,
  className,
  contentAlign = "center",
  size = "default",
  variant = "default",
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  // 共享层持有完整视觉契约，业务调用方只需选择语义变体和尺寸。
  return (
    <Component
      className={cn(buttonVariants({ className, contentAlign, size, variant }))}
      data-content-align={contentAlign}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
