import { TEMPORARY_TASK_SCOPE_ID, type AgentTask } from "@/protocol/index.js";
import {
  Archive,
  ArrowUpRight,
  CircleCheckBig,
  CircleX,
  Clock3,
  Copy,
  Ellipsis,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { useTaskInteractionBlocked } from "../task-interaction-context.js";

type TaskLinkProps = Readonly<{
  active: boolean;
  attention: TaskAttention;
  icon?: ReactNode;
  isActionPending: boolean;
  isAwaitingApproval: boolean;
  isRunning: boolean;
  onArchive: (task: AgentTask) => void;
  onDelete: (task: AgentTask) => void;
  onPin: (task: AgentTask) => void;
  onRename: (task: AgentTask) => void;
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
  icon,
  isActionPending: actionPending,
  isAwaitingApproval,
  isRunning,
  onArchive,
  onDelete,
  onPin,
  onRename,
  task,
}: TaskLinkProps) {
  const { t } = useTranslation("workbench");
  const taskRoute = getTaskRoute(task.projectId, task.id);
  const isActionPending = useTaskInteractionBlocked(task.projectId, task.id) || actionPending;

  return (
    <div className="group relative mr-1 min-w-0">
      <Link
        aria-current={active ? "page" : undefined}
        className={`flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-body-small transition-colors ${
          active
            ? "bg-control-active font-medium text-foreground"
            : "text-muted-foreground hover:bg-control-hover hover:text-foreground"
        }`}
        {...taskRoute}
      >
        {icon === undefined ? null : (
          <span className="shrink-0 text-subtle-foreground">{icon}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
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
  icon: ReactNode | null;
  label: string;
  tone: string;
}>;

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
      icon: <Clock3 aria-hidden="true" className="size-3.5" strokeWidth={2} />,
      label: t("sidebar.taskApproval"),
      tone: "text-task-waiting",
    };
  } else if (isRunning) {
    presentation = {
      icon: null,
      label: t("sidebar.taskRunning"),
      tone: "text-task-running",
    };
  } else if (attention === "completed") {
    presentation = {
      icon: <CircleCheckBig aria-hidden="true" className="size-3.5" strokeWidth={2} />,
      label: t("sidebar.taskComplete"),
      tone: "text-task-completed",
    };
  } else if (attention === "failed") {
    presentation = {
      icon: <CircleX aria-hidden="true" className="size-3.5" strokeWidth={2} />,
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
      {presentation.icon ?? (
        <span
          aria-hidden="true"
          className="task-status-dot block size-2 rounded-full bg-current"
        />
      )}
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

function copyTaskId(taskId: string): void {
  // 复制失败不阻塞菜单关闭，用户可重新打开菜单重试。
  void navigator.clipboard.writeText(taskId).catch(() => undefined);
}

export function TaskActionMenu({
  isPending: actionPending,
  onArchive,
  onDelete,
  onPin,
  onRename,
  task,
}: TaskActionMenuProps) {
  const { t } = useTranslation("workbench");
  const isPending = useTaskInteractionBlocked(task.projectId, task.id) || actionPending;
  return (
    <DropdownMenuContent
      align="start"
      aria-label={t("sidebar.taskActions", { task: task.title })}
      aria-labelledby={undefined}
      className="w-40"
    >
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={() => {
        void import("../../task-window/open-task-window.js")
          .then(({ openTaskWindowFromMenu }) => openTaskWindowFromMenu(task.projectId, task.id))
          .catch(() => toast.error(t("taskWindow.failed")));
      }}>
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
        {t("taskWindow.open")}
      </DropdownMenuItem>
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={onPin}>
        <Pin className="size-3.5" aria-hidden="true" />
        {task.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
      </DropdownMenuItem>
      <DropdownMenuItem className={taskActionClassName} disabled={isPending} onSelect={onRename}>
        <Pencil className="size-3.5" aria-hidden="true" />
        {t("sidebar.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={taskActionClassName}
        disabled={isPending}
        onSelect={() => {
          copyTaskId(task.id);
        }}
      >
        <Copy className="size-3.5" aria-hidden="true" />
        {t("sidebar.copyTaskId")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={taskActionClassName}
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
