import { cn } from "../lib/utils.js";

export const dialogSurfaceClass =
  "fixed left-1/2 top-1/2 z-50 grid min-w-0 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-xl border border-separator-strong bg-dialog p-6 text-foreground shadow-panel outline-none motion-safe:transition-[scale,opacity] motion-safe:duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0";

export function drawerSurfaceClass(direction: "right" | "left" | "up" | "down") {
  return cn(
    "pointer-events-auto fixed z-50 flex min-h-0 min-w-0 flex-col overflow-hidden bg-raised text-foreground shadow-panel outline-none [transform:translate3d(var(--drawer-swipe-movement-x,0px),calc(var(--drawer-swipe-movement-y,0px)+var(--drawer-snap-point-offset,0px)),0)] motion-safe:transition-[transform,translate] motion-safe:duration-180 data-swiping:transition-none",
    direction === "right" &&
      "inset-y-0 right-0 h-dvh w-full rounded-l-xl border-l border-separator data-starting-style:translate-x-full data-ending-style:translate-x-full sm:max-w-[32rem]",
    direction === "left" &&
      "inset-y-0 left-0 h-dvh w-full rounded-r-xl border-r border-separator data-starting-style:-translate-x-full data-ending-style:-translate-x-full sm:max-w-[32rem]",
    direction === "up" &&
      "inset-x-0 top-0 max-h-dvh rounded-b-xl border-b border-separator data-starting-style:-translate-y-full data-ending-style:-translate-y-full",
    direction === "down" &&
      "inset-x-0 bottom-0 max-h-dvh rounded-t-xl border-t border-separator data-starting-style:translate-y-full data-ending-style:translate-y-full",
  );
}

// 两类浮层共用独立的标准关闭控件：32px 方形按钮、16px 图标，不继承标题尺寸。
export const modalCloseClass =
  "absolute right-4 top-4 z-10 size-8 shrink-0 rounded-md text-muted-foreground opacity-70 hover:opacity-100 focus-visible:opacity-100";
