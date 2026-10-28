import { HoverCard as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
export const HoverCard = Primitive.Root;
export const HoverCardTrigger = Primitive.Trigger;
export function HoverCardContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="hover-card-content"
        data-floating-surface
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-64 rounded-surface border border-separator bg-panel p-3 text-foreground shadow-floating",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
