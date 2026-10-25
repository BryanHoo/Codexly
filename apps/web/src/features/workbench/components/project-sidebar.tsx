import { getTaskRoute } from "./project-sidebar-task-row.js";
import { useSplitWorkspaceActions } from "@codexly/ui/core/split-workspace";
import { useSidebarDraftNavigation } from "@codexly/ui/core/split-draft-navigation";
import { Link, useNavigate } from "@tanstack/react-router";
import { TEMPORARY_TASK_SCOPE_ID, type AgentTask, type Project } from "@codexly/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { getPinnedTasks } from "../../projects/project-data.js";
import {
  useProjectActions,
  useProjectActivity,
  useProjectData,
  usePinnedProjectTasks,
} from "../../projects/project-context.js";
import {
  cacheRemovedProjectTask,
  cachePinnedProjectTask,
  cacheRenamedProjectTask,
  taskArchiveMutationOptions,
  taskPinMutationOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { removeRetainedTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { useProjectReordering } from "../hooks/use-project-reordering.js";
import { useTaskDeletion } from "../hooks/use-task-deletion.js";
import { useCloseMobileSidebar } from "../hooks/use-close-mobile-sidebar.js";
import {
  getProjectSidebarPreferenceStorage,
  readExpandedProjectIds,
  resolveInitialExpandedProjectIds,
  writeExpandedProjectIds,
} from "../project-sidebar-preferences.js";
import { ProjectSidebarDialogs } from "./project-sidebar-dialogs.js";
import type { ArchivedTaskScope } from "./archived-tasks-dialog.js";
import { ProjectSidebarTaskList } from "./project-sidebar-task-list.js";
import { TaskDeleteDialog } from "./task-delete-dialog.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";
import { groupTasksByProjectId } from "./project-sidebar-state.js";
import { SidebarScheduledTasksLink } from "./sidebar-scheduled-tasks-link.js";
import { SidebarTaskBoardLink } from "./sidebar-task-board-link.js";
import { SidebarSkillsMarketLink } from "./sidebar-skills-market-link.js";
import { ProjectSidebarHeader } from "./project-sidebar-header.js";
import type { ProjectSidebarProps } from "./project-sidebar-props.js";
export { ProductBrand } from "./project-sidebar-header.js";
export * from "./project-sidebar-actions.js";
export * from "./project-sidebar-state.js";
export * from "./project-sidebar-task-row.js";
// 归档管理仅在打开时读取代码，普通任务导航保持轻量。
const ArchivedTasksDialog = lazy(() =>
  import("./archived-tasks-dialog.js").then((module) => ({ default: module.ArchivedTasksDialog })),
);
const GlobalSearchDialog = lazy(() =>
  import("../../search/global-search-dialog.js").then((module) => ({
    default: module.GlobalSearchDialog,
  })),
);
const primaryActionClassName =
  "flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";
export function ProjectSidebar({
  appInfo,
  appUpdate,
  connectionState,
  onClose,
  onOpenSettings,
  onOpenFile,
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
  const workspaceActions = useSplitWorkspaceActions();
  const queryClient = useQueryClient();
  const sidebarRef = useRef<HTMLElement>(null);
  const closeOnMobile = useCloseMobileSidebar(sidebarRef, onClose);
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
  const [searchState, setSearchState] = useState<"idle" | "open" | "closed">("idle");
  const [expandedTaskProjects, setExpandedTaskProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renamingTask, setRenamingTask] = useState<AgentTask | null>(null);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  const [archivedProject, setArchivedProject] = useState<ArchivedTaskScope | null>(null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [projectPickerMode, setProjectPickerMode] = useState<"existing" | "create">("existing");
  const pinMutation = useMutation(taskPinMutationOptions(client));
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const archiveMutation = useMutation(taskArchiveMutationOptions(client));
  const taskActionLockRef = useRef(createAsyncActionLock());
  const taskDeletion = useTaskDeletion({
    actionLock: taskActionLockRef.current,
    activeProjectId: projectId,
    activeTaskId: taskId,
  });
  const normalizedQuery = "";
  const taskSearch = { error: null, isPending: false };
  const pinnedTaskQuery = usePinnedProjectTasks();
  const visibleTasks = tasks;
  // 大列表只分组一次，Project 渲染不再重复扫描全部 Task。
  const tasksByProjectId = useMemo(() => groupTasksByProjectId(visibleTasks), [visibleTasks]);
  const pinnedTasks = getPinnedTasks(pinnedTaskQuery.tasks);
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

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const hasVisibleDialog = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]'),
      ).some((element) => element.getClientRects().length > 0);
      if (
        sidebarRef.current?.getClientRects().length === 0 ||
        hasVisibleDialog ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLocaleLowerCase() !== "f" ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      setSearchState("open");
    };
    document.addEventListener("keydown", openSearch);
    return () => {
      document.removeEventListener("keydown", openSearch);
    };
  }, []);

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
      setIsProjectPickerOpen(false);
      if (projectPickerMode === "create") await openProjectDraft(project.id);
    }
    return project !== undefined;
  };
  const { openDraft, onNewTaskClick } = useSidebarDraftNavigation(TEMPORARY_TASK_SCOPE_ID, (id) =>
    (id === TEMPORARY_TASK_SCOPE_ID
      ? navigate({ to: "/temporary" })
      : navigate({ params: { projectId: id }, to: "/p/$projectId" })
    ).then(closeOnMobile),
  );
  const openProjectDraft = async (targetProjectId: string) => {
    // 项目切换和新建入口都只打开 Project 草稿，首次提交后才展示真实 Task。
    updateExpandedProjects((current) =>
      current.has(targetProjectId) ? current : new Set([...current, targetProjectId]),
    );
    await openDraft(targetProjectId);
  };

  const pinTask = (task: AgentTask) =>
    taskActionLockRef.current.run(async () => {
      try {
        const response = await pinMutation.mutateAsync({
          pinned: !task.pinned,
          projectId: task.projectId,
          taskId: task.id,
        });
        cachePinnedProjectTask(queryClient, response.task, response.pinnedTasks.data);
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
        cacheRenamedProjectTask(queryClient, response.task, response.taskCatalog.data);
        setRenamingTask(null);
      } catch {
        // 根级 MutationCache 已展示失败 toast。
      }
    });

  const archiveTask = (task: AgentTask) =>
    taskActionLockRef.current.run(async () => {
      try {
        const response = await archiveMutation.mutateAsync({
          projectId: task.projectId,
          taskId: task.id,
        });
        cacheRemovedProjectTask(queryClient, task.projectId, task.id, response.tasks);
        queryClient.removeQueries({
          exact: true,
          queryKey: ["projects", task.projectId, "tasks", task.id],
        });
        forgetTask(task.projectId, task.id);
        // 归档与删除共用窗口清理规则，不能让原 URL 重置仍在显示的聊天。
        const handled = workspaceActions?.dismiss({ projectId: task.projectId, taskId: task.id });
        if (!handled && task.projectId === projectId && task.id === taskId) {
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
      ref={sidebarRef}
    >
      <ProjectSidebarHeader
        onClose={onClose}
        onSearch={() => {
          setSearchState("open");
        }}
      >
        <SidebarScheduledTasksLink {...(projectId === undefined ? {} : { projectId })} />
        <SidebarSkillsMarketLink {...(projectId === undefined ? {} : { projectId })} />
      </ProjectSidebarHeader>

      <nav className="space-y-0.5 px-2" aria-label={t("sidebar.agentNavigation")}>
        <Link className={primaryActionClassName} to="/temporary" onClick={onNewTaskClick}>
          <Send className={primaryActionIconClassName} aria-hidden="true" />
          {t("sidebar.newTask")}
        </Link>
        <SidebarTaskBoardLink
          className={primaryActionClassName}
          iconClassName={primaryActionIconClassName}
          {...(projectId === undefined ? {} : { projectId })}
        />
      </nav>
      <ProjectSidebarTaskList
        exportTask={(task) =>
          import("../export-task-conversation.js").then(({ exportTaskConversation }) =>
            exportTaskConversation(client, task),
          )
        }
        onTaskNavigate={closeOnMobile}
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
        onOpenTemporaryDraft={() => void openDraft(TEMPORARY_TASK_SCOPE_ID)}
        onOpenProjectDraft={openProjectDraft}
        onOpenArchived={setArchivedProject}
        onOpenProjectPicker={(mode) => {
          setProjectPickerMode(mode);
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

      <Suspense fallback={null}>
        {archivedProject === null ? null : (
          <ArchivedTasksDialog
            client={client}
            onClose={() => {
              closeProjectDialog(archivedProject.id);
            }}
            project={archivedProject}
          />
        )}
      </Suspense>

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
        projectPickerMode={projectPickerMode}
        onAddProject={addSelectedProject}
        onCloseProjectDialog={closeProjectDialog}
        onCloseProjectPicker={() => {
          if (!isProjectAddPending) setIsProjectPickerOpen(false);
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

      <div className="px-2">
        <SidebarSettingsButton
          {...appUpdate}
          {...(appInfo === undefined ? {} : { appInfo })}
          connectionState={connectionState}
          onTaskNavigate={(projectId, taskId) => {
            if (!workspaceActions?.select({ projectId, taskId }))
              void navigate(getTaskRoute(projectId, taskId)).then(closeOnMobile);
            else closeOnMobile();
          }}
          onOpen={onOpenSettings}
        />
      </div>
      {searchState === "idle" ? null : (
        <Suspense fallback={null}>
          <GlobalSearchDialog
            client={client}
            onOpenFile={onOpenFile}
            onClose={() => {
              setSearchState("closed");
            }}
            open={searchState === "open"}
            projects={projects}
          />
        </Suspense>
      )}
    </aside>
  );
}
