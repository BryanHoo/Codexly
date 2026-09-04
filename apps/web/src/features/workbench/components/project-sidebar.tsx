import { Link, useNavigate } from "@tanstack/react-router";
import type { AgentEventConnectionState } from "@codexly/client";
import {
  TEMPORARY_TASK_SCOPE_ID,
  type AgentTask,
  type AppInfoResponse,
  type Project,
} from "@codexly/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PanelLeftClose, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { getPinnedTasks } from "../../projects/project-data.js";
import {
  useProjectActions,
  useProjectActivity,
  useProjectData,
  usePinnedProjectTasks,
  useProjectTaskSearch,
} from "../../projects/project-context.js";
import {
  removeArchivedProjectTaskAndRefill,
  replaceProjectTaskInQueryCaches,
  taskArchiveMutationOptions,
  taskPinMutationOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { removeRetainedTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { useProjectReordering } from "../hooks/use-project-reordering.js";
import { useTaskDeletion } from "../hooks/use-task-deletion.js";
import {
  getProjectSidebarPreferenceStorage,
  readExpandedProjectIds,
  resolveInitialExpandedProjectIds,
  writeExpandedProjectIds,
} from "../project-sidebar-preferences.js";

import { ProjectSidebarDialogs } from "./project-sidebar-dialogs.js";
import { ArchivedTasksDialog, type ArchivedTaskScope } from "./archived-tasks-dialog.js";
import { ProjectSidebarTaskList } from "./project-sidebar-task-list.js";
import { TaskDeleteDialog } from "./task-delete-dialog.js";
import { SidebarSettingsButton, type SidebarSettingsSection } from "./project-sidebar-actions.js";
import { groupTasksByProjectId } from "./project-sidebar-state.js";
import { SidebarTaskBoardLink } from "./sidebar-task-board-link.js";
import { SidebarSkillsMarketLink } from "./sidebar-skills-market-link.js";
export * from "./project-sidebar-actions.js";
export * from "./project-sidebar-state.js";
export * from "./project-sidebar-task-row.js";

const primaryActionClassName =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";
type ProjectSidebarProps = Readonly<{
  appInfo?: AppInfoResponse;
  connectionState: AgentEventConnectionState;
  onClose: () => void;
  onOpenSettings: (section: SidebarSettingsSection) => void;
  projectId?: string;
  taskId?: string;
}>;

export function ProjectSidebar({
  appInfo,
  connectionState,
  onClose,
  onOpenSettings,
  projectId,
  taskId,
}: ProjectSidebarProps) {
  const { t } = useTranslation("workbench");
  const { client, error, isPending, projects, projectTaskStates, tasks } = useProjectData();
  const {
    addProject,
    fetchNextProjectTaskPage,
    forgetTask,
    reorderProjects,
    removeProject,
    renameProject,
    setExpandedProjectTaskIds,
  } = useProjectActions();
  const { isProjectActionPending, isProjectOrderPending, isProjectAddPending, taskActivity } =
    useProjectActivity();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [preferenceStorage] = useState(getProjectSidebarPreferenceStorage);
  const [initialSavedExpandedProjectIds] = useState(() =>
    readExpandedProjectIds(preferenceStorage),
  );
  const savedExpandedProjectIdsRef = useRef(initialSavedExpandedProjectIds);
  const hasInitializedProjectExpansionRef = useRef(projects.length > 0);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(() =>
    resolveInitialExpandedProjectIds(
      projects.map((project) => project.id),
      initialSavedExpandedProjectIds,
    ),
  );
  const expandedProjectsRef = useRef(expandedProjects);
  const [query, setQuery] = useState("");
  const [expandedTaskProjects, setExpandedTaskProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renamingTask, setRenamingTask] = useState<AgentTask | null>(null);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  const [archivedProject, setArchivedProject] = useState<ArchivedTaskScope | null>(null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const pinMutation = useMutation(taskPinMutationOptions(client));
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const archiveMutation = useMutation(taskArchiveMutationOptions(client));
  const taskActionLockRef = useRef(createAsyncActionLock());
  const taskDeletion = useTaskDeletion({
    actionLock: taskActionLockRef.current,
    activeProjectId: projectId,
    activeTaskId: taskId,
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const taskSearch = useProjectTaskSearch(normalizedQuery);
  const pinnedTaskQuery = usePinnedProjectTasks();
  const visibleTasks = normalizedQuery.length === 0 ? tasks : taskSearch.tasks;
  // 大列表只分组一次，Project 渲染不再重复扫描全部 Task。
  const tasksByProjectId = useMemo(() => groupTasksByProjectId(visibleTasks), [visibleTasks]);
  const pinnedTasks = getPinnedTasks(
    normalizedQuery.length === 0 ? pinnedTaskQuery.tasks : visibleTasks,
  );
  const hasTaskError =
    pinnedTaskQuery.error !== null ||
    [...projectTaskStates.values()].some((state) => state.error !== null);
  const taskActionPending =
    pinMutation.isPending ||
    renameMutation.isPending ||
    archiveMutation.isPending ||
    taskDeletion.isDeletePending;
  const {
    activeProjectId: reorderingProjectId,
    announcement: projectOrderAnnouncement,
    getProjectReorderProps,
    orderedProjects,
  } = useProjectReordering({
    disabled: isProjectOrderPending,
    onReorder: reorderProjects,
    projects,
  });
  useEffect(() => {
    if (
      isPending ||
      projectId === undefined ||
      projectId === TEMPORARY_TASK_SCOPE_ID ||
      projects.some((project) => project.id === projectId)
    ) {
      return;
    }
    // 缓存提交后再修正已删除 Project 的路由，避免事件回调与 React Query 渲染竞态。
    const nextProject = projects[0];
    void (nextProject === undefined
      ? navigate({ replace: true, to: "/" })
      : navigate({ params: { projectId: nextProject.id }, replace: true, to: "/p/$projectId" }));
  }, [isPending, navigate, projectId, projects]);

  useEffect(() => {
    // 首次加载只展开第一个 Project；已有配置则恢复上次保存的文件夹形态。
    const projectIds = projects.map((project) => project.id);
    if (!hasInitializedProjectExpansionRef.current && projectIds.length > 0) {
      hasInitializedProjectExpansionRef.current = true;
      const initialExpandedProjectIds = resolveInitialExpandedProjectIds(
        projectIds,
        savedExpandedProjectIdsRef.current,
      );
      expandedProjectsRef.current = initialExpandedProjectIds;
      setExpandedProjects(initialExpandedProjectIds);
      return;
    }

    const availableProjectIds = new Set(projectIds);
    const currentExpandedProjectIds = expandedProjectsRef.current;
    const nextExpandedProjectIds = new Set(
      [...currentExpandedProjectIds].filter((expandedProjectId) =>
        availableProjectIds.has(expandedProjectId),
      ),
    );
    if (nextExpandedProjectIds.size !== currentExpandedProjectIds.size) {
      expandedProjectsRef.current = nextExpandedProjectIds;
      setExpandedProjects(nextExpandedProjectIds);
    }
  }, [projects]);

  useEffect(() => {
    // 任务列表请求跟随可见文件夹；当前路由 Project 由 ProjectProvider 单独保持激活。
    setExpandedProjectTaskIds(expandedProjects);
  }, [expandedProjects, setExpandedProjectTaskIds]);

  const updateExpandedProjects = useCallback(
    (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
      const nextExpandedProjectIds = update(expandedProjectsRef.current);
      expandedProjectsRef.current = nextExpandedProjectIds;
      savedExpandedProjectIdsRef.current = nextExpandedProjectIds;
      writeExpandedProjectIds(preferenceStorage, nextExpandedProjectIds);
      setExpandedProjects(nextExpandedProjectIds);
    },
    [preferenceStorage],
  );

  const toggleProject = (targetProjectId: string) => {
    // Project 名称只控制任务树展开形态，新聊天导航由独立的“+”入口负责。
    updateExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(targetProjectId)) {
        next.delete(targetProjectId);
      } else {
        next.add(targetProjectId);
      }
      return next;
    });
  };

  const addSelectedProject = async (rootPaths: readonly string[]) => {
    const project = await addProject(rootPaths);
    if (project !== undefined) {
      // 新增 Project 保持收起，交由用户显式展开任务列表。
      setIsProjectPickerOpen(false);
    }
  };

  const openProjectDraft = async (targetProjectId: string) => {
    // 项目切换和新建入口都只打开 Project 草稿，首次提交后才展示真实 Task。
    updateExpandedProjects((current) => {
      if (current.has(targetProjectId)) {
        return current;
      }
      const next = new Set(current);
      next.add(targetProjectId);
      return next;
    });
    await navigate({ params: { projectId: targetProjectId }, to: "/p/$projectId" });
  };

  const replaceTaskCache = (task: AgentTask) => {
    // Mutation 成功后原位更新对应 Project，避免任务跳到列表顶部或等待 Provider 最终一致。
    replaceProjectTaskInQueryCaches(queryClient, task);
  };

  const pinTask = (task: AgentTask) =>
    taskActionLockRef.current.run(async () => {
      try {
        const response = await pinMutation.mutateAsync({
          pinned: !task.pinned,
          projectId: task.projectId,
          taskId: task.id,
        });
        replaceTaskCache(response.task);
      } catch {
        // 根级 MutationCache 已展示失败 toast。
      }
    });

  const renameTask = (task: AgentTask, title: string) =>
    taskActionLockRef.current.run(async () => {
      try {
        const response = await renameMutation.mutateAsync({
          projectId: task.projectId,
          taskId: task.id,
          title,
        });
        replaceTaskCache(response.task);
        setRenamingTask(null);
      } catch {
        // 根级 MutationCache 已展示失败 toast。
      }
    });

  const archiveTask = (task: AgentTask) =>
    taskActionLockRef.current.run(async () => {
      try {
        await archiveMutation.mutateAsync({ projectId: task.projectId, taskId: task.id });
        await removeArchivedProjectTaskAndRefill(queryClient, task.projectId, task.id);
        queryClient.removeQueries({
          exact: true,
          queryKey: ["projects", task.projectId, "tasks", task.id],
        });
        forgetTask(task.projectId, task.id);
        if (task.projectId === projectId && task.id === taskId) {
          await (task.projectId === TEMPORARY_TASK_SCOPE_ID
            ? navigate({ to: "/temporary" })
            : navigate({ params: { projectId: task.projectId }, to: "/p/$projectId" }));
        }
        removeRetainedTaskRuntime(task.projectId, task.id);
        // 归档后的 Runtime 清理由 Provider 判定安全性，失败不回滚已成功的归档。
        void client.unsubscribeTask(task.projectId, task.id).catch(() => undefined);
      } catch {
        // 根级 MutationCache 已展示失败 toast。
      }
    });

  const closeProjectDialog = (targetProjectId: string) => {
    setArchivedProject(null);
    setRenamingProject(null);
    setRemovingProject(null);
    requestAnimationFrame(() => {
      document.getElementById(`project-actions-${targetProjectId}`)?.focus();
    });
  };

  const submitProjectRename = async (project: Project, name: string) => {
    if (await renameProject(project.id, name)) {
      closeProjectDialog(project.id);
    }
  };

  const confirmProjectRemoval = async (project: Project) => {
    const remainingProjects = await removeProject(project.id);
    if (remainingProjects === undefined) {
      return;
    }
    setRemovingProject(null);
  };

  return (
    <aside
      aria-label={t("sidebar.landmark")}
      className="workbench-sidebar z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-sidebar shadow-divider"
    >
      <div className="flex h-workbench-header items-center gap-2 px-3">
        {/* 品牌标识只承担展示职责，新聊天由下方的显式入口创建。 */}
        <ProductBrand />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t("sidebar.close")}
              className="min-workbench:hidden"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <PanelLeftClose className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.close")}</TooltipContent>
        </Tooltip>
      </div>

      <nav className="space-y-0.5 px-2" aria-label={t("sidebar.agentNavigation")}>
        <div className="relative px-1 pb-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label={t("sidebar.search")}
            className="h-9 w-full rounded-control bg-control pl-8 pr-2.5 text-body-small text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:shadow-focus"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder={t("sidebar.search")}
            value={query}
          />
        </div>
        <Link className={primaryActionClassName} to="/temporary">
          <Send className={primaryActionIconClassName} aria-hidden="true" />
          {t("sidebar.newTask")}
        </Link>
        <SidebarTaskBoardLink
          className={primaryActionClassName}
          iconClassName={primaryActionIconClassName}
          {...(projectId === undefined ? {} : { projectId })}
        />
        <SidebarSkillsMarketLink
          className={primaryActionClassName}
          iconClassName={primaryActionIconClassName}
          {...(projectId === undefined ? {} : { projectId })}
        />
      </nav>

      <ProjectSidebarTaskList
        archiveTask={archiveTask}
        deleteTask={taskDeletion.requestTaskDeletion}
        error={error}
        expandedProjects={expandedProjects}
        expandedTaskProjects={expandedTaskProjects}
        fetchNextProjectTaskPage={fetchNextProjectTaskPage}
        getProjectReorderProps={getProjectReorderProps}
        hasTaskError={hasTaskError}
        isPending={isPending}
        isProjectActionPending={isProjectActionPending}
        isProjectAddPending={isProjectAddPending}
        normalizedQuery={normalizedQuery}
        onOpenTemporaryDraft={() => {
          void navigate({ to: "/temporary" });
        }}
        onOpenProjectDraft={openProjectDraft}
        onOpenArchived={setArchivedProject}
        onOpenProjectPicker={() => {
          setIsProjectPickerOpen(true);
        }}
        onRemoveProject={(project) => {
          setRemovingProject(project);
        }}
        onRenameProject={(project) => {
          setRenamingProject(project);
        }}
        orderedProjects={orderedProjects}
        pinTask={pinTask}
        pinnedTasks={pinnedTasks}
        {...(projectId === undefined ? {} : { projectId })}
        projectOrderAnnouncement={projectOrderAnnouncement}
        projectTaskStates={projectTaskStates}
        reorderingProjectId={reorderingProjectId}
        setExpandedTaskProjects={setExpandedTaskProjects}
        setRenamingTask={setRenamingTask}
        taskActionPending={taskActionPending}
        taskActivity={taskActivity}
        {...(taskId === undefined ? {} : { taskId })}
        taskSearch={taskSearch}
        tasksByProjectId={tasksByProjectId}
        toggleProject={toggleProject}
      />

      {archivedProject === null ? null : (
        <ArchivedTasksDialog
          client={client}
          onClose={() => {
            closeProjectDialog(archivedProject.id);
          }}
          project={archivedProject}
        />
      )}

      {taskDeletion.deletingTask === null ? null : (
        <TaskDeleteDialog
          isPending={taskDeletion.isDeletePending}
          onClose={taskDeletion.closeTaskDeletion}
          onDelete={() => {
            void taskDeletion.confirmTaskDeletion();
          }}
          task={taskDeletion.deletingTask}
        />
      )}

      <ProjectSidebarDialogs
        client={client}
        isProjectActionPending={isProjectActionPending}
        isProjectAddPending={isProjectAddPending}
        isProjectPickerOpen={isProjectPickerOpen}
        onAddProject={addSelectedProject}
        onCloseProjectDialog={closeProjectDialog}
        onCloseProjectPicker={() => {
          if (!isProjectAddPending) {
            setIsProjectPickerOpen(false);
          }
        }}
        onCloseTaskRename={() => {
          setRenamingTask(null);
        }}
        onRemoveProject={(project) => {
          void confirmProjectRemoval(project);
        }}
        onRenameProject={(project, name) => {
          void submitProjectRename(project, name);
        }}
        onRenameTask={(task, title) => {
          void renameTask(task, title);
        }}
        removingProject={removingProject}
        renamingProject={renamingProject}
        renamingTask={renamingTask}
        taskRenamePending={renameMutation.isPending}
      />

      <div className="p-2">
        <SidebarSettingsButton
          {...(appInfo === undefined ? {} : { appInfo })}
          connectionState={connectionState}
          onOpen={onOpenSettings}
        />
      </div>
    </aside>
  );
}

export function ProductBrand() {
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <img
        alt="Codexly"
        className="h-7 w-auto max-w-full"
        height="28"
        src="/brand/codexly-logo.svg"
        width="116"
      />
    </div>
  );
}
