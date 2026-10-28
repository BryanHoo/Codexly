import { Progress as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";
export function Progress({ value, className, ...props }: ComponentProps<typeof Primitive.Root>) {
  const percentage = Math.min(100, Math.max(0, value ?? 0));
  return (
    <Primitive.Root
      data-slot="progress"
      value={value ?? null}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-pill bg-control", className)}
      {...props}
    >
      <Primitive.Indicator
        className="size-full bg-brand transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(-${String(100 - percentage)}%)` }}
      />
    </Primitive.Root>
  );
}
