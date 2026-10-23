import { CircleCheck, Clock3 } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import type { SidebarActiveTask } from "@codexly/frontend-core/sidebar-task-shortcuts";
import { splitPaneKey } from "@codexly/frontend-core/split-workspace";
import { useSplitWorkspace } from "./split-workspace.js";
import { SidebarTaskLabel } from "./sidebar-task-label.js";

export function SidebarActiveTaskRow({
  task,
  active,
  projectName,
  labels,
  renderLink,
}: Readonly<{
  task: SidebarActiveTask;
  active: boolean;
  projectName: string;
  labels: Readonly<{ approval: string; input?: string; running: string; completed: string }>;
  renderLink: (props: {
    taskActive: boolean;
    className: string;
    onClick: MouseEventHandler<HTMLAnchorElement>;
    children: ReactNode;
  }) => ReactNode;
}>) {
  const workspace = useSplitWorkspace();
  const pane = { projectId: task.projectId, taskId: task.id };
  if (workspace !== null && workspace.panes.length > 0)
    active = workspace.activeKey === splitPaneKey(pane);
  return renderLink({
    taskActive: active,
    className: `flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-body-small transition-colors ${active ? "bg-control-active font-medium text-foreground" : "text-muted-foreground hover:bg-control-hover hover:text-foreground"}`,
    onClick: (event) => {
      // 运行快捷入口与项目任务遵守同一分屏选择规则；普通单窗和修饰键交给路由。
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (workspace?.select(pane)) event.preventDefault();
    },
    children: (
      <>
        <SidebarTaskLabel engine={task.engine} projectName={projectName} title={task.title} />
        <span
          role="status"
          aria-label={
            task.status === "input" ? (labels.input ?? labels.approval) : labels[task.status]
          }
          className={`sidebar-shortcut-status ml-auto inline-grid size-3.5 shrink-0 place-items-center ${task.status === "approval" || task.status === "input" ? "text-task-waiting" : task.status === "completed" ? "text-task-completed" : "text-task-running"}`}
        >
          {task.status === "approval" || task.status === "input" ? (
            <Clock3 aria-hidden="true" className="size-3.5 stroke-[2.25]" />
          ) : task.status === "completed" ? (
            <CircleCheck aria-hidden="true" className="size-3.5 stroke-[2.25]" />
          ) : (
            <span
              aria-hidden="true"
              className="task-status-dot block size-2 rounded-full bg-current"
            />
          )}
        </span>
      </>
    ),
  });
}
