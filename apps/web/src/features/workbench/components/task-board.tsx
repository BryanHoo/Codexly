import type { AgentTask, Project } from "@codexly/protocol";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  FolderClosed,
  ListFilter,
  LoaderCircle,
  Pin,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEventHandler } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/core/select.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { ProjectTodoItem } from "../project-todo-context.js";
import { getProjectTodoSummary } from "../project-todo-summary.js";
import type { TaskBoardTask } from "../task-board-state.js";
import { formatTaskBoardElapsed } from "../task-board-time.js";

type TaskBoardProps = Readonly<{
  approval: readonly TaskBoardTask[];
  completed: readonly AgentTask[];
  completedError: boolean;
  hasNextCompletedPage: boolean;
  isCompletedPending: boolean;
  isLoadingMoreCompleted: boolean;
  isTaskUnviewed: (projectId: string, taskId: string) => boolean;
  onCreateTask: (projectId: string | null) => void;
  onLoadMoreCompleted: () => Promise<void>;
  onOpenTask: (task: TaskBoardTask | AgentTask) => void;
  onOpenTodo: (todo: ProjectTodoItem) => void;
  onProjectFilterChange: (projectId: string | null) => void;
  onRetryCompleted: () => void;
  projects: readonly Project[];
  running: readonly TaskBoardTask[];
  selectedProjectId: string | null;
  todos: readonly ProjectTodoItem[];
}>;

const ALL_PROJECTS_FILTER = "__all_projects__";
const TASK_BOARD_CLOCK_INTERVAL_MS = 60_000;
const taskDateFormatters = new Map<string, Intl.DateTimeFormat>();

function TaskBoardColumn({
  children,
  count,
  emptyLabel,
  emptyState,
  icon,
  label,
  onScroll,
  tone,
}: Readonly<{
  children: ReactNode;
  count: number;
  emptyLabel: string;
  emptyState?: ReactNode;
  icon: ReactNode;
  label: string;
  onScroll?: UIEventHandler<HTMLDivElement>;
  tone: "approval" | "completed" | "todo" | "running";
}>) {
  return (
    <section className="task-board-column" data-tone={tone}>
      <header className="task-board-column-header">
        <span className="task-board-column-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 className="text-body-small font-semibold" id={`task-board-${tone}`}>
          {label} {count}
        </h2>
      </header>
      <div
        aria-labelledby={`task-board-${tone}`}
        className="task-board-column-list"
        onScroll={onScroll}
        role="list"
      >
        {count === 0
          ? (emptyState ?? <div className="task-board-empty">{emptyLabel}</div>)
          : children}
      </div>
    </section>
  );
}

function formatTaskTime(value: number | string, locale: string): string {
  let formatter = taskDateFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    });
    taskDateFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(value));
}

function useTaskBoardNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const syncTimer = () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        timer = window.setInterval(() => {
          setNow(Date.now());
        }, TASK_BOARD_CLOCK_INTERVAL_MS);
      }
    };
    syncTimer();
    document.addEventListener("visibilitychange", syncTimer);
    return () => {
      document.removeEventListener("visibilitychange", syncTimer);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [enabled]);
  return now;
}

function TaskCard({
  id,
  onOpen,
  pinned = false,
  projectName,
  runningFor,
  statusLabel,
  title,
  tone,
  unviewed = false,
  updatedAt,
}: Readonly<{
  id: string;
  onOpen: () => void;
  pinned?: boolean;
  projectName: string;
  runningFor?: string;
  statusLabel: string;
  title: string;
  tone: "approval" | "completed" | "todo" | "running";
  unviewed?: boolean;
  updatedAt?: number | string;
}>) {
  const { t, i18n } = useTranslation("workbench");
  return (
    <div role="listitem">
      <div
        className="task-board-card"
        data-attention={unviewed ? "new-completion" : undefined}
        data-tone={tone}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t(tone === "todo" ? "taskBoard.openTodo" : "taskBoard.openTask", {
                task: title,
                todo: title,
              })}
              className="task-board-card-open"
              onClick={onOpen}
              type="button"
            />
          </TooltipTrigger>
          <TooltipContent className="break-words">{title}</TooltipContent>
        </Tooltip>
        <span className="task-board-card-topline">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={t("taskBoard.copyTaskId", { id })}
                className="task-board-card-id"
                onClick={() => void navigator.clipboard.writeText(id).catch(() => undefined)}
                type="button"
              >
                ID: {id}
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("taskBoard.copyTaskIdHint")}</TooltipContent>
          </Tooltip>
          <span className="task-board-card-status">
            <span aria-hidden="true" className="task-board-card-status-dot" />
            {unviewed ? t("taskBoard.newCompleted") : statusLabel}
          </span>
        </span>
        <span className="task-board-card-title" title={title}>
          {title}
        </span>
        <span className="task-board-card-footer">
          <span className="task-board-card-project" title={projectName}>
            <FolderClosed aria-hidden="true" />
            <span>{projectName}</span>
          </span>
          <span className="task-board-card-facts">
            {pinned ? <Pin aria-label={t("taskBoard.pinned")} /> : null}
            {runningFor === undefined ? null : (
              <span className="task-board-card-fact">
                <Clock3 aria-hidden="true" />
                {runningFor}
              </span>
            )}
            {runningFor !== undefined || updatedAt === undefined ? null : (
              <time className="task-board-card-fact" dateTime={new Date(updatedAt).toISOString()}>
                <Clock3 aria-hidden="true" />
                {formatTaskTime(updatedAt, i18n.language)}
              </time>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

function CompletedLoadError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <div role="listitem">
      <div className="task-board-column-error" role="alert">
        <CircleAlert aria-hidden="true" />
        <span>{t("taskBoard.completedLoadError")}</span>
        <Button
          aria-label={t("taskBoard.retryCompleted")}
          onClick={onRetry}
          size="icon-toolbar"
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function TaskBoard(props: TaskBoardProps) {
  const { t } = useTranslation("workbench");
  const completedLoadRequestedRef = useRef(false);
  useEffect(() => {
    if (!props.isLoadingMoreCompleted) completedLoadRequestedRef.current = false;
  }, [props.isLoadingMoreCompleted]);
  const projectNames = useMemo(
    () => new Map(props.projects.map((project) => [project.id, project.name])),
    [props.projects],
  );
  const filter = <T extends { projectId: string }>(items: readonly T[]) =>
    props.selectedProjectId === null
      ? items
      : items.filter((item) => item.projectId === props.selectedProjectId);
  const todos = filter(props.todos);
  const running = filter(props.running);
  const approval = filter(props.approval);
  const completed = filter(props.completed);
  const now = useTaskBoardNow(running.length > 0);
  const openTaskCard = (
    task: TaskBoardTask | AgentTask,
    tone: "approval" | "completed" | "running",
  ) => {
    const startedAt =
      "startedAt" in task && typeof task.startedAt === "string" ? task.startedAt : undefined;
    const updatedAt =
      "updatedAt" in task && typeof task.updatedAt === "string" ? task.updatedAt : undefined;
    return (
      <TaskCard
        id={task.id}
        key={`${task.projectId}:${task.id}`}
        onOpen={() => {
          props.onOpenTask(task);
        }}
        pinned={"pinned" in task && task.pinned}
        projectName={projectNames.get(task.projectId) ?? task.projectId}
        statusLabel={t(`taskBoard.${tone}`)}
        title={task.title}
        tone={tone}
        unviewed={tone === "completed" && props.isTaskUnviewed(task.projectId, task.id)}
        {...(startedAt === undefined
          ? {}
          : {
              runningFor: t("taskBoard.runningFor", {
                duration: formatTaskBoardElapsed(startedAt, now) ?? "-",
              }),
            })}
        {...(updatedAt === undefined ? {} : { updatedAt })}
      />
    );
  };
  return (
    <section aria-label={t("taskBoard.label")} className="task-board">
      <div className="task-board-toolbar">
        <Select
          onValueChange={(value) => {
            props.onProjectFilterChange(value === ALL_PROJECTS_FILTER ? null : value);
          }}
          value={props.selectedProjectId ?? ALL_PROJECTS_FILTER}
        >
          <SelectTrigger
            aria-label={t("taskBoard.projectFilter")}
            className="task-board-project-filter"
            size="sm"
          >
            <ListFilter aria-hidden="true" className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={ALL_PROJECTS_FILTER}>{t("taskBoard.allProjects")}</SelectItem>
            {props.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => {
            props.onCreateTask(props.selectedProjectId);
          }}
          size="sm"
          type="button"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {t("sidebar.newTask")}
        </Button>
      </div>
      <div className="task-board-grid">
        <TaskBoardColumn
          count={todos.length}
          emptyLabel={t("taskBoard.emptyTodos")}
          icon={<FileText className="size-3.5" />}
          label={t("taskBoard.todo")}
          tone="todo"
        >
          {todos.map((item) => {
            const title = getProjectTodoSummary(
              item.record,
              t("composer.attachmentCount", { count: item.record.draft.attachments.length }),
            );
            return (
              <TaskCard
                id={item.record.id}
                key={`${item.projectId}:${item.record.id}`}
                onOpen={() => {
                  props.onOpenTodo(item);
                }}
                projectName={projectNames.get(item.projectId) ?? item.projectId}
                statusLabel={t("taskBoard.todo")}
                title={title}
                tone="todo"
                updatedAt={item.record.updatedAt}
              />
            );
          })}
        </TaskBoardColumn>
        <TaskBoardColumn
          count={running.length}
          emptyLabel={t("taskBoard.emptyRunning")}
          icon={<Activity className="size-3.5" />}
          label={t("taskBoard.running")}
          tone="running"
        >
          {running.map((task) => openTaskCard(task, "running"))}
        </TaskBoardColumn>
        <TaskBoardColumn
          count={approval.length}
          emptyLabel={t("taskBoard.emptyApproval")}
          icon={<CircleAlert className="size-3.5" />}
          label={t("taskBoard.approval")}
          tone="approval"
        >
          {approval.map((task) => openTaskCard(task, "approval"))}
        </TaskBoardColumn>
        <TaskBoardColumn
          count={completed.length}
          emptyLabel={t(
            props.isCompletedPending ? "taskBoard.loading" : "taskBoard.emptyCompleted",
          )}
          emptyState={
            props.completedError ? (
              <CompletedLoadError onRetry={props.onRetryCompleted} />
            ) : undefined
          }
          icon={<CheckCircle2 className="size-3.5" />}
          label={t("taskBoard.completed")}
          onScroll={(event) => {
            const list = event.currentTarget;
            if (
              list.scrollHeight - list.scrollTop - list.clientHeight <= 32 &&
              props.hasNextCompletedPage &&
              !props.isLoadingMoreCompleted &&
              !completedLoadRequestedRef.current
            ) {
              completedLoadRequestedRef.current = true;
              void props.onLoadMoreCompleted().catch(() => {
                completedLoadRequestedRef.current = false;
              });
            }
          }}
          tone="completed"
        >
          {completed.map((task) => openTaskCard(task, "completed"))}
          {props.completedError ? <CompletedLoadError onRetry={props.onRetryCompleted} /> : null}
          {props.isLoadingMoreCompleted ? (
            <div className="task-board-page-loading" role="status">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              {t("taskBoard.loadingMore")}
            </div>
          ) : null}
        </TaskBoardColumn>
      </div>
    </section>
  );
}
