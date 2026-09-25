import type { AgentTask, Project } from "@/protocol/index.js";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  FolderClosed,
  ListFilter,
  LoaderCircle,
  Paperclip,
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
import {
  getApplicationDetailViewUpdateGate,
  runDetailViewInterval,
} from "../../../shared/lifecycle/application-visibility.js";
import type { ProjectDraftItem } from "../project-draft-context.js";
import { getProjectDraftSummary } from "../project-draft-summary.js";
import type { TaskBoardTask } from "../task-board-state.js";
import { formatTaskBoardElapsed } from "../task-board-time.js";

type TaskBoardProps = Readonly<{
  completed: readonly AgentTask[];
  completedError: boolean;
  drafts: readonly ProjectDraftItem[];
  hasNextCompletedPage: boolean;
  isCompletedPending: boolean;
  isLoadingMoreCompleted: boolean;
  isTaskUnviewed: (projectId: string, taskId: string) => boolean;
  onCreateTask: (projectId: string | null) => void;
  onLoadMoreCompleted: () => Promise<void>;
  onOpenDraft: (draft: ProjectDraftItem) => void;
  onOpenTask: (task: TaskBoardTask) => void;
  onProjectFilterChange: (projectId: string | null) => void;
  onRetryCompleted: () => void;
  approval: readonly TaskBoardTask[];
  projects: readonly Project[];
  running: readonly TaskBoardTask[];
  selectedProjectId: string | null;
}>;

const ALL_PROJECTS_FILTER = "__all_projects__";

type TaskBoardColumnProps = Readonly<{
  children: ReactNode;
  count: number;
  emptyLabel: string;
  emptyState?: ReactNode;
  icon: ReactNode;
  label: string;
  onScroll?: UIEventHandler<HTMLDivElement>;
  tone: "approval" | "completed" | "draft" | "running";
}>;

function TaskBoardColumn({
  children,
  count,
  emptyLabel,
  emptyState,
  icon,
  label,
  onScroll,
  tone,
}: TaskBoardColumnProps) {
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
        className="task-board-column-list"
        aria-labelledby={`task-board-${tone}`}
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

type TaskCardTone = "approval" | "completed" | "draft" | "running";

const TASK_BOARD_CLOCK_INTERVAL_MS = 60_000;

const taskDateFormatters = new Map<string, Intl.DateTimeFormat>();

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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    // 看板只按分钟刷新一次，并在应用进入后台后暂停计时提交。
    const calibrationTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const stopInterval = runDetailViewInterval(
      getApplicationDetailViewUpdateGate(),
      () => setNow(Date.now()),
      TASK_BOARD_CLOCK_INTERVAL_MS,
    );
    return () => {
      window.clearTimeout(calibrationTimer);
      stopInterval();
    };
  }, [enabled]);
  return now;
}

function TaskCard({
  attachmentCount = 0,
  id,
  onOpen,
  pinned = false,
  projectName,
  statusLabel,
  title,
  tone,
  unviewed = false,
  runningFor,
  updatedAt,
}: Readonly<{
  attachmentCount?: number;
  id: string;
  onOpen: () => void;
  pinned?: boolean;
  projectName: string;
  statusLabel: string;
  title: string;
  tone: TaskCardTone;
  unviewed?: boolean;
  runningFor?: string;
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
              aria-label={t(tone === "draft" ? "taskBoard.openDraft" : "taskBoard.openTask", {
                draft: title,
                task: title,
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
                onClick={() => {
                  void navigator.clipboard.writeText(id).catch(() => undefined);
                }}
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
            {attachmentCount > 0 ? (
              <span className="task-board-card-fact">
                <Paperclip aria-hidden="true" />
                {attachmentCount}
              </span>
            ) : null}
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
          title={t("taskBoard.retryCompleted")}
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function TaskBoard({
  completed,
  completedError,
  drafts,
  hasNextCompletedPage,
  isCompletedPending,
  isLoadingMoreCompleted,
  isTaskUnviewed,
  onCreateTask,
  onLoadMoreCompleted,
  onOpenDraft,
  onOpenTask,
  onProjectFilterChange,
  onRetryCompleted,
  approval,
  projects,
  running,
  selectedProjectId,
}: TaskBoardProps) {
  const { t } = useTranslation("workbench");
  const completedLoadRequestedRef = useRef(false);
  useEffect(() => {
    if (!isLoadingMoreCompleted) completedLoadRequestedRef.current = false;
  }, [isLoadingMoreCompleted]);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const visibleDrafts =
    selectedProjectId === null
      ? drafts
      : drafts.filter((draft) => draft.projectId === selectedProjectId);
  const visibleRunning =
    selectedProjectId === null
      ? running
      : running.filter((task) => task.projectId === selectedProjectId);
  const visibleApproval =
    selectedProjectId === null
      ? approval
      : approval.filter((task) => task.projectId === selectedProjectId);
  const visibleCompleted =
    selectedProjectId === null
      ? completed
      : completed.filter((task) => task.projectId === selectedProjectId);
  const now = useTaskBoardNow(visibleRunning.length > 0);

  return (
    <section aria-label={t("taskBoard.label")} className="task-board">
      <div className="task-board-toolbar">
        <Select
          onValueChange={(value) => {
            onProjectFilterChange(value === ALL_PROJECTS_FILTER ? null : value);
          }}
          value={selectedProjectId ?? ALL_PROJECTS_FILTER}
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
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => onCreateTask(selectedProjectId)} size="sm" type="button">
          <Plus aria-hidden="true" className="size-3.5" />
          {t("sidebar.newTask")}
        </Button>
      </div>
      <div className="task-board-grid">
        <TaskBoardColumn
          count={visibleDrafts.length}
          emptyLabel={t("taskBoard.emptyDrafts")}
          icon={<FileText className="size-3.5" />}
          label={t("taskBoard.draft")}
          tone="draft"
        >
          {visibleDrafts.map((item) => {
            const { projectId, record: draft } = item;
            const attachmentFallback = t("composer.attachmentCount", {
              count: draft.draft.attachments.length,
            });
            const summary = getProjectDraftSummary(draft, attachmentFallback);
            return (
              <TaskCard
                attachmentCount={draft.draft.attachments.length}
                id={draft.id}
                key={`${projectId}:${draft.id}`}
                onOpen={() => onOpenDraft(item)}
                projectName={projectNames.get(projectId) ?? projectId}
                statusLabel={t("taskBoard.draft")}
                title={summary}
                tone="draft"
                updatedAt={draft.updatedAt}
              />
            );
          })}
        </TaskBoardColumn>
        <TaskBoardColumn
          count={visibleRunning.length}
          emptyLabel={t("taskBoard.emptyRunning")}
          icon={<Activity className="size-3.5" />}
          label={t("taskBoard.running")}
          tone="running"
        >
          {visibleRunning.map((task) => (
            <TaskCard
              id={task.id}
              key={`${task.projectId}:${task.id}`}
              onOpen={() => onOpenTask(task)}
              projectName={projectNames.get(task.projectId) ?? task.projectId}
              statusLabel={t("taskBoard.running")}
              title={task.title}
              tone="running"
              {...(task.startedAt === undefined
                ? {}
                : {
                    runningFor: t("taskBoard.runningFor", {
                      duration: formatTaskBoardElapsed(task.startedAt, now) ?? "-",
                    }),
                  })}
              {...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt })}
            />
          ))}
        </TaskBoardColumn>
        <TaskBoardColumn
          count={visibleApproval.length}
          emptyLabel={t("taskBoard.emptyApproval")}
          icon={<CircleAlert className="size-3.5" />}
          label={t("taskBoard.approval")}
          tone="approval"
        >
          {visibleApproval.map((task) => (
            <TaskCard
              id={task.id}
              key={`${task.projectId}:${task.id}`}
              onOpen={() => onOpenTask(task)}
              projectName={projectNames.get(task.projectId) ?? task.projectId}
              statusLabel={t("taskBoard.approval")}
              title={task.title}
              tone="approval"
              {...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt })}
            />
          ))}
        </TaskBoardColumn>
        <TaskBoardColumn
          count={visibleCompleted.length}
          emptyLabel={t(isCompletedPending ? "taskBoard.loading" : "taskBoard.emptyCompleted")}
          emptyState={completedError ? <CompletedLoadError onRetry={onRetryCompleted} /> : undefined}
          icon={<CheckCircle2 className="size-3.5" />}
          label={t("taskBoard.completed")}
          onScroll={(event) => {
            const list = event.currentTarget;
            const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
            if (
              remaining <= 32 &&
              hasNextCompletedPage &&
              !isLoadingMoreCompleted &&
              !completedLoadRequestedRef.current
            ) {
              completedLoadRequestedRef.current = true;
              void onLoadMoreCompleted().catch(() => {
                completedLoadRequestedRef.current = false;
              });
            }
          }}
          tone="completed"
        >
          {visibleCompleted.map((task) => (
            <TaskCard
              id={task.id}
              key={`${task.projectId}:${task.id}`}
              onOpen={() => onOpenTask(task)}
              pinned={task.pinned}
              projectName={projectNames.get(task.projectId) ?? task.projectId}
              statusLabel={t("taskBoard.completed")}
              title={task.title}
              tone="completed"
              unviewed={isTaskUnviewed(task.projectId, task.id)}
              updatedAt={task.updatedAt}
            />
          ))}
          {completedError ? <CompletedLoadError onRetry={onRetryCompleted} /> : null}
          {isLoadingMoreCompleted ? (
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
