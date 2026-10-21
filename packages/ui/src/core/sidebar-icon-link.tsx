import type { ReactElement } from "react";

import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export function SidebarIconLink({
  children,
  label,
}: Readonly<{ children: ReactElement; label: string }>) {
  // 两端复用图标入口样式与提示，保留子链接原有的路由、激活态和点击行为。
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          aria-label={label}
          className="data-[status=active]:bg-control-active data-[status=active]:text-foreground"
          size="icon-sm"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
