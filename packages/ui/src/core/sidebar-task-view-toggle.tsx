import { FolderTree, History } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  readSidebarTaskView,
  writeSidebarTaskView,
  type SidebarTaskView,
} from "@codexly/frontend-core/sidebar-task-view";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export function useSidebarTaskView(storage: Parameters<typeof readSidebarTaskView>[0]) {
  const [view, setView] = useState(() => readSidebarTaskView(storage));
  const changeView = (next: SidebarTaskView) => {
    writeSidebarTaskView(storage, next);
    setView(next);
  };
  return [view, changeView] as const;
}

export function SidebarTaskViewToggle({
  view,
  onChange,
  labels,
}: Readonly<{
  view: SidebarTaskView;
  onChange: (view: SidebarTaskView) => void;
  labels: Readonly<{ timeline: string; projects: string }>;
}>) {
  const label = view === "projects" ? labels.timeline : labels.projects;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={label}
          // 鼠标悬停栏目或键盘聚焦时显示；无悬停能力的触屏保留入口，透明时仍占位以避免标题抖动。
          className="opacity-0 transition-opacity group-hover/sidebar-task-header:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100"
          onClick={() => {
            onChange(view === "projects" ? "timeline" : "projects");
          }}
        >
          {view === "projects" ? (
            <History className="size-3.5" aria-hidden="true" />
          ) : (
            <FolderTree className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarTaskViewHeader({
  title,
  children,
  ...toggle
}: Parameters<typeof SidebarTaskViewToggle>[0] & Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="group/sidebar-task-header flex h-8 min-w-0 w-full shrink-0 items-center justify-between pl-2">
      <h2 className="text-body-small font-semibold text-foreground" id="projects-title">
        {title}
      </h2>
      <div className="flex shrink-0 items-center gap-0.5">
        <SidebarTaskViewToggle {...toggle} />
        {children}
      </div>
    </div>
  );
}
