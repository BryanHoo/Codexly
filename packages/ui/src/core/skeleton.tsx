import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";

/** shadcn Skeleton 原语：仅用 CSS 呼吸动画，减少动态效果时保持静止。 */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-control-hover motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
