import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

const inputVariants = cva(
  "min-w-0 text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        compact:
          "h-8 w-full rounded-control bg-raised px-2.5 text-label shadow-sm focus-visible:shadow-focus",
        default: "h-9 w-full rounded-control bg-control px-3 text-body focus-visible:shadow-focus",
        embedded: "flex-1 bg-transparent",
        outline:
          "h-11 w-full rounded-control border border-separator-strong bg-panel px-3 text-body-small focus-visible:border-brand focus-visible:shadow-focus sm:h-9",
      },
    },
  },
);

type InputProps = ComponentProps<"input"> & VariantProps<typeof inputVariants>;

function Input({ className, type, variant = "default", ...props }: InputProps) {
  return (
    <input
      className={cn(inputVariants({ className, variant }))}
      data-slot="input"
      data-variant={variant}
      type={type}
      {...props}
    />
  );
}

export { Input, inputVariants, type InputProps };
