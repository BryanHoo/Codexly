import { forwardRef, type ComponentPropsWithoutRef } from "react";

// 路由仍停在原任务时，TanStack Link 会补写 aria-current；最终锚点以分屏焦点为准。
export const SidebarTaskAnchor = forwardRef<
  HTMLAnchorElement,
  ComponentPropsWithoutRef<"a"> & { taskActive: boolean }
>(function SidebarTaskAnchor({ taskActive, ...props }, ref) {
  return (
    <a
      {...props}
      ref={ref}
      aria-current={taskActive ? "page" : undefined}
      data-status={taskActive ? "active" : undefined}
    />
  );
});
