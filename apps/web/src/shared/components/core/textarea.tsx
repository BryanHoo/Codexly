import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

const textareaVariants = cva(
  "min-w-0 text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default:
          "min-h-20 w-full resize-y rounded-control bg-control px-3 py-2 text-body focus-visible:shadow-focus",
        embedded: "flex-1 resize-none bg-transparent",
      },
    },
  },
);

type TextareaProps = ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>;

function Textarea({ className, variant = "default", ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(textareaVariants({ className, variant }))}
      data-slot="textarea"
      data-variant={variant}
      {...props}
    />
  );
}

export { Textarea, textareaVariants, type TextareaProps };
