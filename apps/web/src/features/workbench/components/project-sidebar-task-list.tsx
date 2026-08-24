import { TEMPORARY_TASK_SCOPE_ID, type AgentTask, type Project } from "@codexly/protocol";
import { Folder, MessageSquareText, Pin, Plus } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { getTaskActivity, type TaskActivityMap } from "../../conversation/runtime/task-activity.js";
import { getProjectTaskPreview, PROJECT_TASK_PREVIEW_LIMIT } from "../../projects/project-data.js";
import type { ProjectTaskListState } from "../../projects/project-context.js";
import type { useProjectReordering } from "../hooks/use-project-reordering.js";
import {
  getProjectSidebarPreferenceStorage,
  readTemporaryTasksExpanded,
  writeTemporaryTasksExpanded,
} from "../project-sidebar-preferences.js";
import { ProjectActions, ProjectPickerButton } from "./project-sidebar-actions.js";
import { getProjectTaskPaginationControl } from "./project-sidebar-state.js";
import { TaskLink } from "./project-sidebar-task-row.js";

const EMPTY_PROJECT_TASKS: readonly AgentTask[] = [];

type ProjectSidebarTaskListProps = Readonly<{
  archiveTask: (task: AgentTask) => unknown;
  deleteTask: (task: AgentTask) => unknown;
  error: Error | null;
  expandedProjects: ReadonlySet<string>;
  expandedTaskProjects: ReadonlySet<string>;
  fetchNextProjectTaskPage: (projectId: string) => Promise<void>;
  getProjectReorderProps: ReturnType<typeof useProjectReordering>["getProjectReorderProps"];
  hasTaskError: boolean;
  isPending: boolean;
  isProjectActionPending: boolean;
  isProjectAddPending: boolean;
  normalizedQuery: string;
  onOpenTemporaryDraft: () => void;
  onOpenProjectDraft: (projectId: string) => Promise<void>;
  onOpenArchived: (project: Project) => void;
  onOpenProjectPicker: () => void;
  onRemoveProject: (project: Project) => void;
  onRenameProject: (project: Project) => void;
  orderedProjects: readonly Project[];
  pinTask: (task: AgentTask) => unknown;
  pinnedTasks: readonly AgentTask[];
  projectId?: string;
  projectOrderAnnouncement: string;
  projectTaskStates: ReadonlyMap<string, ProjectTaskListState>;
  reorderingProjectId: string | null;
  setExpandedTaskProjects: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setRenamingTask: Dispatch<SetStateAction<AgentTask | null>>;
  taskActionPending: boolean;
  taskActivity: TaskActivityMap;
  taskId?: string;
  taskSearch: Readonly<{ error: Error | null; isPending: boolean }>;
  tasksByProjectId: ReadonlyMap<string, readonly AgentTask[]>;
  toggleProject: (projectId: string) => void;
}>;

export function ProjectSidebarTaskList({
  archiveTask,
  deleteTask,
  error,
  expandedProjects,
  expandedTaskProjects,
  fetchNextProjectTaskPage,
  getProjectReorderProps,
  hasTaskError,
  isPending,
  isProjectActionPending,
  isProjectAddPending,
  normalizedQuery,
  onOpenTemporaryDraft,
  onOpenProjectDraft: openProjectDraft,
  onOpenArchived,
  onOpenProjectPicker,
  onRemoveProject,
  onRenameProject,
  orderedProjects,
  pinTask,
  pinnedTasks,
  projectId,
  projectOrderAnnouncement,
  projectTaskStates,
  reorderingProjectId,
  setExpandedTaskProjects,
  setRenamingTask,
  taskActionPending,
  taskActivity,
  taskId,
  taskSearch,
  tasksByProjectId,
  toggleProject,
}: ProjectSidebarTaskListProps) {
  const { t } = useTranslation("workbench");
  // 临时任务与 Project 文件夹保持一致：标题控制列表可见性，“+”独立创建任务。
  const [preferenceStorage] = useState(getProjectSidebarPreferenceStorage);
  const [temporaryTasksExpanded, setTemporaryTasksExpanded] = useState(() =>
    readTemporaryTasksExpanded(preferenceStorage),
  );
  const temporaryTasks = tasksByProjectId.get(TEMPORARY_TASK_SCOPE_ID) ?? EMPTY_PROJECT_TASKS;
  const temporaryTaskState = projectTaskStates.get(TEMPORARY_TASK_SCOPE_ID);
  const showAllTemporaryTasks = expandedTaskProjects.has(TEMPORARY_TASK_SCOPE_ID);
  const temporaryTaskPreview = getProjectTaskPreview(temporaryTasks, showAllTemporaryTasks);
  const temporaryPaginationControl = getProjectTaskPaginationControl({
    error: temporaryTaskState?.error ?? null,
    hasHiddenLoadedTasks: temporaryTasks.length > PROJECT_TASK_PREVIEW_LIMIT,
    hasNextPage: normalizedQuery.length === 0 ? (temporaryTaskState?.hasNextPage ?? false) : false,
    isExpanded: showAllTemporaryTasks,
    isFetchingNextPage: temporaryTaskState?.isFetchingNextPage ?? false,
  });
  return (
    <>
      {/* 限制项目区的固有宽度，长 Task 标题不能把右侧操作按钮推出 Sidebar。 */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden px-2 pt-5">
        {pinnedTasks.length > 0 ? (
          <section
            className="mb-4 max-h-40 shrink-0 overflow-y-auto"
            aria-labelledby="pinned-title"
          >
            <h2
              className="px-2 pb-2 text-meta font-semibold text-muted-foreground"
              id="pinned-title"
            >
              {t("sidebar.pinned")}
            </h2>
            <div className="space-y-0.5">
              {pinnedTasks.map((task) => {
                const activity = getTaskActivity(taskActivity, task.projectId, task.id);
                return (
                  <TaskLink
                    active={task.projectId === projectId && task.id === taskId}
                    attention={activity.attention}
                    icon={<Pin className="size-3.5" aria-hidden="true" />}
                    key={`${task.projectId}:${task.id}`}
                    isActionPending={taskActionPending}
                    isAwaitingApproval={activity.isAwaitingApproval}
                    isRunning={activity.isRunning}
                    onArchive={(task) => void archiveTask(task)}
                    onDelete={(task) => void deleteTask(task)}
                    onPin={(task) => void pinTask(task)}
                    onRename={setRenamingTask}
                    task={task}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="projects-title">
          <div className="flex h-8 min-w-0 w-full shrink-0 items-center justify-between pl-2">
            <h2 className="text-body-small font-semibold text-foreground" id="projects-title">
              {t("sidebar.projects")}
            </h2>
            <ProjectPickerButton
              disabled={isProjectAddPending}
              onOpen={() => {
                onOpenProjectPicker();
              }}
            />
          </div>

          {isPending ? (
            <p className="px-2 py-1.5 text-meta text-subtle-foreground">
              {t("sidebar.taskLoading")}
            </p>
          ) : null}
          {taskSearch.isPending ? (
            <p className="px-2 py-1.5 text-meta text-subtle-foreground">{t("sidebar.searchAll")}</p>
          ) : null}
          {error === null && !hasTaskError ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              {t("sidebar.errorLoadTasks")}
            </p>
          )}
          {taskSearch.error === null ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              {t("sidebar.errorSearchTasks")}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {projectOrderAnnouncement}
          </p>

          <div
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-3"
            data-testid="project-tree-scroll"
          >
            <section className="min-w-0" aria-labelledby="temporary-tasks-title">
              <TemporaryTasksHeading
                expanded={temporaryTasksExpanded}
                onCreate={onOpenTemporaryDraft}
                onToggle={() => {
                  setTemporaryTasksExpanded((current) => {
                    const expanded = !current;
                    writeTemporaryTasksExpanded(preferenceStorage, expanded);
                    return expanded;
                  });
                }}
              />
              {temporaryTasksExpanded ? (
                <div className="min-w-0 space-y-0.5 pl-5" id="temporary-tasks-content">
                  {temporaryTaskPreview.tasks.map((task) => {
                    const activity = getTaskActivity(taskActivity, task.projectId, task.id);
                    return (
                      <TaskLink
                        active={projectId === TEMPORARY_TASK_SCOPE_ID && task.id === taskId}
                        attention={activity.attention}
                        isActionPending={taskActionPending}
                        isAwaitingApproval={activity.isAwaitingApproval}
                        isRunning={activity.isRunning}
                        key={`${task.projectId}:${task.id}`}
                        onArchive={(task) => void archiveTask(task)}
                        onDelete={(task) => void deleteTask(task)}
                        onPin={(task) => void pinTask(task)}
                        onRename={setRenamingTask}
                        task={task}
                      />
                    );
                  })}
                  {temporaryTaskState?.isPending === true ? (
                    <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                      {t("sidebar.taskLoading")}
                    </p>
                  ) : null}
                  {temporaryPaginationControl === null ? null : (
                    <Button
                      variant="ghost"
                      aria-expanded={showAllTemporaryTasks}
                      className="flex h-7 w-full items-center rounded-control px-2 text-left text-meta font-medium text-subtle-foreground transition-colors hover:bg-control-hover hover:text-foreground"
                      contentAlign="start"
                      disabled={temporaryPaginationControl.disabled}
                      onClick={() => {
                        if (
                          temporaryPaginationControl.action === "expand" ||
                          temporaryPaginationControl.action === "expand-and-load"
                        ) {
                          setExpandedTaskProjects((current) =>
                            new Set(current).add(TEMPORARY_TASK_SCOPE_ID),
                          );
                        } else if (temporaryPaginationControl.action === "collapse") {
                          setExpandedTaskProjects((current) => {
                            const next = new Set(current);
                            next.delete(TEMPORARY_TASK_SCOPE_ID);
                            return next;
                          });
                        }
                        if (
                          temporaryPaginationControl.action === "expand-and-load" ||
                          temporaryPaginationControl.action === "load"
                        ) {
                          void fetchNextProjectTaskPage(TEMPORARY_TASK_SCOPE_ID).catch(
                            () => undefined,
                          );
                        }
                      }}
                      type="button"
                    >
                      {temporaryPaginationControl.label}
                    </Button>
                  )}
                  {temporaryTasks.length === 0 &&
                  normalizedQuery.length === 0 &&
                  temporaryTaskState?.isPending !== true ? (
                    <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                      {t("sidebar.noTemporaryTasks")}
                    </p>
                  ) : null}
                  {temporaryTasks.length === 0 &&
                  normalizedQuery.length > 0 &&
                  !taskSearch.isPending &&
                  taskSearch.error === null ? (
                    <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                      {t("sidebar.noMatchingTasks")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
            {orderedProjects.map((project) => {
              const projectTasks = tasksByProjectId.get(project.id) ?? EMPTY_PROJECT_TASKS;
              const expanded = expandedProjects.has(project.id);
              const showAllTasks = expandedTaskProjects.has(project.id);
              const taskPreview = getProjectTaskPreview(projectTasks, showAllTasks);
              const projectTaskState = projectTaskStates.get(project.id);
              const taskPaginationControl = getProjectTaskPaginationControl({
                error: projectTaskState?.error ?? null,
                hasHiddenLoadedTasks: projectTasks.length > PROJECT_TASK_PREVIEW_LIMIT,
                hasNextPage:
                  normalizedQuery.length === 0 ? (projectTaskState?.hasNextPage ?? false) : false,
                isExpanded: showAllTasks,
                isFetchingNextPage: projectTaskState?.isFetchingNextPage ?? false,
              });

              return (
                <div
                  className={`min-w-0 transition-[opacity,transform] ${
                    reorderingProjectId === project.id ? "relative z-10 opacity-80" : ""
                  }`}
                  data-project-reordering={reorderingProjectId === project.id ? "true" : "false"}
                  key={project.id}
                >
                  <div className="group/project flex min-w-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      aria-expanded={expanded}
                      aria-label={t("sidebar.toggleProject", { project: project.name })}
                      className={`flex h-8 min-w-0 flex-1 touch-pan-y select-none items-center gap-2 rounded-control px-2 text-body-small font-medium transition-colors hover:bg-control-hover hover:text-foreground ${
                        reorderingProjectId === project.id
                          ? "cursor-grabbing bg-control-active text-foreground shadow-sm"
                          : "cursor-grab text-muted-foreground"
                      }`}
                      contentAlign="start"
                      onClick={() => {
                        toggleProject(project.id);
                      }}
                      type="button"
                      {...getProjectReorderProps(project.id)}
                    >
                      <Folder className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{project.name}</span>
                    </Button>
                    <ProjectActions
                      isPending={isProjectActionPending}
                      onOpenArchived={onOpenArchived}
                      onRemove={(targetProject) => {
                        onRemoveProject(targetProject);
                      }}
                      onRename={(targetProject) => {
                        onRenameProject(targetProject);
                      }}
                      project={project}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={t("sidebar.createInProject", { project: project.name })}
                          onClick={() => {
                            void openProjectDraft(project.id);
                          }}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("sidebar.createInProject", { project: project.name })}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {expanded ? (
                    <div className="mt-0.5 min-w-0 space-y-0.5 pl-5">
                      {taskPreview.tasks.map((task) => {
                        const activity = getTaskActivity(taskActivity, task.projectId, task.id);
                        return (
                          <TaskLink
                            active={project.id === projectId && task.id === taskId}
                            attention={activity.attention}
                            isActionPending={taskActionPending}
                            isAwaitingApproval={activity.isAwaitingApproval}
                            isRunning={activity.isRunning}
                            key={`${task.projectId}:${task.id}`}
                            onArchive={(task) => void archiveTask(task)}
                            onDelete={(task) => void deleteTask(task)}
                            onPin={(task) => void pinTask(task)}
                            onRename={setRenamingTask}
                            task={task}
                          />
                        );
                      })}
                      {/* 只在所属文件夹内反馈加载，避免请求状态改变整棵目录树的位置。 */}
                      {projectTaskState?.isPending === true ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                          {t("sidebar.taskLoading")}
                        </p>
                      ) : null}
                      {taskPaginationControl === null ? null : (
                        <Button
                          variant="ghost"
                          aria-expanded={showAllTasks}
                          className="flex h-7 w-full items-center rounded-control px-2 text-left text-meta font-medium text-subtle-foreground transition-colors hover:bg-control-hover hover:text-foreground"
                          contentAlign="start"
                          disabled={taskPaginationControl.disabled}
                          onClick={() => {
                            if (
                              taskPaginationControl.action === "expand" ||
                              taskPaginationControl.action === "expand-and-load"
                            ) {
                              setExpandedTaskProjects((current) =>
                                new Set(current).add(project.id),
                              );
                            } else if (taskPaginationControl.action === "collapse") {
                              setExpandedTaskProjects((current) => {
                                const next = new Set(current);
                                next.delete(project.id);
                                return next;
                              });
                            }

                            if (
                              taskPaginationControl.action === "expand-and-load" ||
                              taskPaginationControl.action === "load"
                            ) {
                              // 下一页错误由对应 Project Query 持有，现有 Task 始终保持可见。
                              void fetchNextProjectTaskPage(project.id).catch(() => undefined);
                            }
                          }}
                          type="button"
                        >
                          {taskPaginationControl.label}
                        </Button>
                      )}
                      {projectTasks.length === 0 &&
                      normalizedQuery.length === 0 &&
                      projectTaskState?.isPending !== true ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                          {t("sidebar.noTasks")}
                        </p>
                      ) : null}
                      {projectTasks.length === 0 &&
                      normalizedQuery.length > 0 &&
                      !taskSearch.isPending &&
                      taskSearch.error === null ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                          {t("sidebar.noMatchingTasks")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

export function TemporaryTasksHeading({
  expanded,
  onCreate,
  onToggle,
}: Readonly<{ expanded: boolean; onCreate: () => void; onToggle: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <div className="flex h-8 items-center gap-0.5 text-muted-foreground">
      <Button
        aria-controls="temporary-tasks-content"
        aria-expanded={expanded}
        className="h-8 min-w-0 flex-1 gap-2 rounded-control px-2 text-body-small font-medium"
        contentAlign="start"
        id="temporary-tasks-title"
        onClick={onToggle}
        type="button"
        variant="ghost"
      >
        <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("sidebar.temporaryTasks")}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("sidebar.newTask")}
            onClick={onCreate}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.newTask")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
