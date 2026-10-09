import { getSplitAction, useSplitWorkspace } from "@codexly/ui/core/split-workspace";
import { splitPaneKey } from "@codexly/frontend-core/split-workspace";
import { PanelsTopLeft } from "lucide-react";
import { SidebarTaskLabel } from "@codexly/ui/core/sidebar-task-label";
import { TEMPORARY_TASK_SCOPE_ID, type AgentTask } from "@codexly/protocol";
import { Archive, CircleCheck, CircleX, Clock3, Ellipsis, Pencil, Pin, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { formatTaskAge } from "../../projects/project-data.js";
import type { TaskAttention } from "../../conversation/runtime/task-activity.js";

type TaskLinkProps = Readonly<{
  active: boolean;
  attention: TaskAttention;
  isActionPending: boolean;
  isAwaitingApproval: boolean;
  isRunning: boolean;
  onArchive: (task: AgentTask) => void;
  onDelete: (task: AgentTask) => void;
  onPin: (task: AgentTask) => void;
  onRename: (task: AgentTask) => void;
  projectName?: string;
  task: AgentTask;
}>;

export function getTaskRoute(projectId: string, taskId: string) {
  return projectId === TEMPORARY_TASK_SCOPE_ID
    ? { params: { taskId }, to: "/temporary/t/$taskId" as const }
    : { params: { projectId, taskId }, to: "/p/$projectId/t/$taskId" as const };
}

export function TaskLink({
  active,
  attention,
  isActionPending,
  isAwaitingApproval,
  isRunning,
  onArchive,
  onDelete,
  onPin,
  onRename,
  projectName,
  task,
}: TaskLinkProps) {
  const { t } = useTranslation("workbench");
  const workspace = useSplitWorkspace();
  const pane = { projectId: task.projectId, taskId: task.id };
  const selected =
    workspace?.panes.some((item) => splitPaneKey(item) === splitPaneKey(pane)) === true;
  if (workspace !== null && workspace.panes.length > 0)
    active = workspace.activeKey === splitPaneKey(pane);
  const taskRoute = getTaskRoute(task.projectId, task.id);

  return (
    <div className="group relative min-w-0">
      <Link
        aria-current={active ? "page" : undefined}
        className={`flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-body-small transition-colors ${
          active
            ? "bg-control-active font-medium text-foreground"
            : "text-muted-foreground hover:bg-control-hover hover:text-foreground"
        }`}
        onClick={(event) => {
          if (!selected || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          workspace.focus(pane);
        }}
        {...taskRoute}
      >
        <SidebarTaskLabel projectName={projectName} title={task.title} />
        <TaskStatusIndicator
          attention={attention}
          isAwaitingApproval={isAwaitingApproval}
          isRunning={isRunning}
          updatedAt={task.updatedAt}
        />
      </Link>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label={t("sidebar.openTaskActions", { task: task.title })}
            className="task-actions absolute right-1 top-1 grid size-6 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus"
            disabled={isActionPending}
            type="button"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <TaskActionMenu
          isPending={isActionPending}
          onArchive={() => {
            onArchive(task);
          }}
          onDelete={() => {
            onDelete(task);
          }}
          onPin={() => {
            onPin(task);
          }}
          onRename={() => {
            onRename(task);
          }}
          task={task}
        />
      </DropdownMenu>
    </div>
  );
}

type TaskStatusIndicatorProps = Readonly<{
  attention: TaskAttention;
  isAwaitingApproval: boolean;
  isRunning: boolean;
  updatedAt: string;
}>;

type TaskStatusPresentation = Readonly<{
  icon: ReactNode;
  label: string;
  tone: string;
}>;

const taskStatusIconClassName = "size-3.5 stroke-[2.25]";

export function TaskStatusIndicator({
  attention,
  isAwaitingApproval,
  isRunning,
  updatedAt,
}: TaskStatusIndicatorProps) {
  const { t } = useTranslation("workbench");
  // 审批等待会暂停正在运行的 Turn，因此必须优先于普通运行态展示。
  let presentation: TaskStatusPresentation | null;
  if (isAwaitingApproval || attention === "approval") {
    presentation = {
      icon: <Clock3 aria-hidden="true" className={taskStatusIconClassName} />,
      label: t("sidebar.taskApproval"),
      tone: "text-task-waiting",
    };
  } else if (isRunning) {
    presentation = {
      icon: (
        <span aria-hidden="true" className="task-status-dot block size-2 rounded-full bg-current" />
      ),
      label: t("sidebar.taskRunning"),
      tone: "text-task-running",
    };
  } else if (attention === "completed") {
    presentation = {
      icon: <CircleCheck aria-hidden="true" className={taskStatusIconClassName} />,
      label: t("sidebar.taskComplete"),
      tone: "text-task-completed",
    };
  } else if (attention === "failed") {
    presentation = {
      icon: <CircleX aria-hidden="true" className={taskStatusIconClassName} />,
      label: t("sidebar.taskIncomplete"),
      tone: "text-task-failed",
    };
  } else {
    presentation = null;
  }

  if (presentation === null) {
    return (
      <span className="task-age task-status ml-auto shrink-0 text-caption text-subtle-foreground">
        {formatTaskAge(updatedAt)}
      </span>
    );
  }

  return (
    <span
      aria-label={presentation.label}
      className={`task-status ml-auto inline-grid size-3.5 shrink-0 place-items-center ${presentation.tone}`}
      role="status"
    >
      {presentation.icon}
    </span>
  );
}

type TaskActionMenuProps = Readonly<{
  isPending: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onPin: () => void;
  onRename: () => void;
  task: AgentTask;
}>;

const taskActionClassName = "h-8 w-full text-left text-foreground";

export function TaskActionMenu({
  isPending,
  onArchive,
  onDelete,
  onPin,
  onRename,
  task,
}: TaskActionMenuProps) {
  const { t } = useTranslation("workbench");
  const workspace = useSplitWorkspace();
  const pane = { projectId: task.projectId, taskId: task.id };
  const splitAction = getSplitAction(workspace, pane);
  return (
    <DropdownMenuContent
      align="start"
      aria-label={t("sidebar.taskActions", { task: task.title })}
      aria-labelledby={undefined}
      className="w-40"
    >
      {splitAction !== null ? (
        <DropdownMenuItem
          className={taskActionClassName}
          disabled={isPending || splitAction !== "add"}
          onSelect={() => workspace?.add(pane)}
        >
          <PanelsTopLeft className="size-3.5" aria-hidden="true" />
          {t(`split.${splitAction}`)}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={onPin}>
        <Pin className="size-3.5" aria-hidden="true" />
        {task.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
      </DropdownMenuItem>
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={onRename}>
        <Pencil className="size-3.5" aria-hidden="true" />
        {t("sidebar.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={`${taskActionClassName} text-danger`}
        disabled={isPending}
        onSelect={onArchive}
      >
        <Archive className="size-3.5" aria-hidden="true" />
        {t("sidebar.archive")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={`${taskActionClassName} text-danger`}
        disabled={isPending}
        onSelect={onDelete}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {t("sidebar.deletePermanently")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
