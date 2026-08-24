import { TEMPORARY_TASK_SCOPE_ID, type Project, type ProjectPage } from "@codexly/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { i18n } from "../../i18n/i18n.js";
import { createAsyncActionLock } from "../../shared/utils/async-action-lock.js";
import { createProjectRuntimeManager } from "../conversation/runtime/project-runtime.js";
import { notifyActionError, notifyActionSuccess } from "../notifications/action-notifications.js";
import {
  buildTaskScopeCollections,
  requestNextProjectTaskPage,
  type ProjectActionsContextValue,
  type ProjectActivityContextValue,
  type ProjectDataContextValue,
  type ProjectTaskQueryResult,
  type ProjectRootSelectionContextValue,
} from "./project-context-state.js";
import { ProjectGitStatusCoordinator } from "./project-git-status-coordinator.js";
import { createProjectGitRuntimeHandlers } from "./project-git-runtime-handlers.js";
import {
  capabilitiesQueryOptions,
  codexlyClient,
  invalidateTaskQueue,
  PROJECT_PINNED_TASKS_KEY,
  PROJECT_TASK_SEARCH_SOURCE_KEY,
  projectRemoveMutationOptions,
  projectRenameMutationOptions,
  projectReorderMutationOptions,
  projectsQueryOptions,
  removeArchivedProjectTaskAndRefill,
  reorderProjectPage,
  taskSnapshotQueryOptions,
  updateTaskTitleInProjectListCaches,
} from "./project-queries.js";
import type { ProjectProviderProps } from "./project-provider-types.js";
import { ProjectProviderView } from "./project-provider-view.js";

const emptyProjects: readonly Project[] = [];

export function ProjectProvider({
  children,
  client = codexlyClient,
  taskNotifier,
}: ProjectProviderProps) {
  const queryClient = useQueryClient();
  const [selectedRootIds, setSelectedRootIds] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const selectedRootIdsRef = useRef(selectedRootIds);
  selectedRootIdsRef.current = selectedRootIds;
  const setSelectedProjectRoot = useCallback((projectId: string, rootId: string) => {
    setSelectedRootIds((current) => {
      if (current.get(projectId) === rootId) return current;
      const next = new Map(current);
      next.set(projectId, rootId);
      return next;
    });
  }, []);
  const gitStatusCoordinator = useMemo(
    () => new ProjectGitStatusCoordinator(queryClient, client),
    [client, queryClient],
  );
  const projectRuntime = useMemo(() => {
    const taskMetadataSyncs = new Map<string, Promise<void>>();
    return createProjectRuntimeManager(client, {
      ...(taskNotifier === undefined ? {} : { taskNotifier }),
      ...createProjectGitRuntimeHandlers({
        coordinator: gitStatusCoordinator,
        getProject: (projectId) =>
          queryClient
            .getQueryData<ProjectPage>(["projects"])
            ?.data.find((candidate) => candidate.id === projectId),
        getSelectedRootIds: () => selectedRootIdsRef.current,
      }),
      onMcpServerStatusChanged(projectId, taskId) {
        // 官方通知只携带启动状态，重新读取清单以补齐工具数、认证和版本元数据。
        void queryClient.invalidateQueries({
          exact: true,
          queryKey: ["projects", projectId, "tasks", taskId, "mcp-servers"],
        });
      },
      onQueueChanged(projectId, taskId) {
        void invalidateTaskQueue(queryClient, projectId, taskId);
      },
      onSkillsChanged(projectId) {
        void queryClient.invalidateQueries({
          exact: true,
          queryKey: ["projects", projectId, "skills"],
        });
      },
      onTaskRemoved(projectId, taskId) {
        void removeArchivedProjectTaskAndRefill(queryClient, projectId, taskId);
        queryClient.removeQueries({
          exact: true,
          queryKey: ["projects", projectId, "tasks", taskId],
        });
      },
      onTaskMetadataChanged(projectId, taskId, reason) {
        const syncTaskMetadata = async () => {
          if (reason === "turn_completed" || reason === "native_notification") {
            // 终态先校准服务端列表顺序，再用 Task Snapshot 保证标题不会被旧列表覆盖。
            await Promise.all([
              queryClient.invalidateQueries({
                exact: true,
                queryKey: ["projects", projectId, "tasks"],
              }),
              queryClient.invalidateQueries({
                exact: true,
                queryKey: ["projects", projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
              }),
              queryClient.invalidateQueries({
                exact: true,
                queryKey: ["projects", projectId, "tasks", PROJECT_PINNED_TASKS_KEY],
              }),
            ]);
          }
          await queryClient.invalidateQueries({
            exact: true,
            queryKey: ["projects", projectId, "tasks", taskId],
            refetchType: "none",
          });
          const response = await queryClient.fetchQuery(
            taskSnapshotQueryOptions(projectId, taskId, client),
          );
          updateTaskTitleInProjectListCaches(queryClient, response.snapshot, {
            assistantReplyStarted: reason === "assistant_reply_started",
          });
        };
        const syncKey = `${projectId}\u0000${taskId}`;
        // 同一 Task 串行同步，避免 Turn 终态复用仍在进行的流式 Snapshot 请求。
        const sync = (taskMetadataSyncs.get(syncKey) ?? Promise.resolve())
          .catch(() => undefined)
          .then(syncTaskMetadata);
        taskMetadataSyncs.set(syncKey, sync);
        const clearCompletedSync = () => {
          if (taskMetadataSyncs.get(syncKey) === sync) {
            taskMetadataSyncs.delete(syncKey);
          }
        };
        void sync.then(clearCompletedSync, clearCompletedSync);
      },
    });
  }, [client, gitStatusCoordinator, queryClient, taskNotifier]);
  const [isProjectAddPending, setIsProjectAddPending] = useState(false);
  const [projectTaskResults, setProjectTaskResults] = useState<
    ReadonlyMap<string, ProjectTaskQueryResult>
  >(() => new Map());
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [expandedProjectTaskIds, setExpandedProjectTaskIdsState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const taskActivity = useSyncExternalStore(
    useCallback(
      (listener: () => void) => projectRuntime.subscribeTaskActivity(listener),
      [projectRuntime],
    ),
    useCallback(() => projectRuntime.getTaskActivity(), [projectRuntime]),
    useCallback(() => projectRuntime.getTaskActivity(), [projectRuntime]),
  );
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const projectsQuery = useQuery(projectsQueryOptions(client));
  const { isPending: isProjectOrderPending, mutateAsync: mutateProjectOrder } = useMutation(
    projectReorderMutationOptions(client),
  );
  const { isPending: isProjectRenamePending, mutateAsync: mutateProjectRename } = useMutation(
    projectRenameMutationOptions(client),
  );
  const { isPending: isProjectRemovePending, mutateAsync: mutateProjectRemove } = useMutation(
    projectRemoveMutationOptions(client),
  );
  const addProjectLockRef = useRef(createAsyncActionLock());
  const projectActionLockRef = useRef(createAsyncActionLock());
  const projectOrderLockRef = useRef(createAsyncActionLock());
  const projects = projectsQuery.data?.data ?? emptyProjects;
  const queriedProjectIds = useMemo(() => {
    const projectIds = new Set(expandedProjectTaskIds);
    if (activeProjectId !== undefined) {
      projectIds.add(activeProjectId);
    }
    return projectIds;
  }, [activeProjectId, expandedProjectTaskIds]);
  const queriedProjects = useMemo(
    () => projects.filter((project) => queriedProjectIds.has(project.id)),
    [projects, queriedProjectIds],
  );
  const queriedTaskScopeIds = useMemo(
    () => [TEMPORARY_TASK_SCOPE_ID, ...queriedProjects.map((project) => project.id)],
    [queriedProjects],
  );
  const projectTaskResultsRef = useRef(projectTaskResults);
  projectTaskResultsRef.current = projectTaskResults;
  const updateProjectTaskResult = useCallback(
    (projectId: string, nextResult: ProjectTaskQueryResult) => {
      projectRuntime.rememberTaskTitles(nextResult.tasks);
      setProjectTaskResults((currentResults) => {
        const currentResult = currentResults.get(projectId);
        if (
          currentResult?.tasks === nextResult.tasks &&
          currentResult.state.error === nextResult.state.error &&
          currentResult.state.hasNextPage === nextResult.state.hasNextPage &&
          currentResult.state.isFetchingNextPage === nextResult.state.isFetchingNextPage &&
          currentResult.state.isPending === nextResult.state.isPending
        ) {
          return currentResults;
        }
        const nextResults = new Map(currentResults);
        nextResults.set(projectId, nextResult);
        return nextResults;
      });
    },
    [projectRuntime],
  );
  const removeProjectTaskResult = useCallback((projectId: string) => {
    setProjectTaskResults((currentResults) => {
      if (!currentResults.has(projectId)) {
        return currentResults;
      }
      const nextResults = new Map(currentResults);
      nextResults.delete(projectId);
      return nextResults;
    });
  }, []);
  const { projectTaskStates, tasks } = useMemo(
    () => buildTaskScopeCollections(queriedTaskScopeIds, projectTaskResults),
    [projectTaskResults, queriedTaskScopeIds],
  );
  const fetchNextProjectTaskPage = useCallback(async (projectId: string) => {
    const controllers = new Map(
      [...projectTaskResultsRef.current].map(([currentProjectId, result]) => [
        currentProjectId,
        result.controller,
      ]),
    );
    await requestNextProjectTaskPage(controllers, projectId);
  }, []);
  const isPending = projectsQuery.isPending;
  const markTaskRunning = useCallback(
    (projectId: string, taskId: string) => {
      projectRuntime.markTaskRunning(projectId, taskId);
    },
    [projectRuntime],
  );
  const forgetTask = useCallback(
    (projectId: string, taskId: string) => {
      projectRuntime.forgetTask(projectId, taskId);
    },
    [projectRuntime],
  );
  const viewTask = useCallback(
    (projectId: string, taskId?: string) => {
      setActiveProjectId((currentProjectId) =>
        currentProjectId === projectId ? currentProjectId : projectId,
      );
      projectRuntime.viewTask(projectId, taskId);
    },
    [projectRuntime],
  );
  const setExpandedProjectTaskIds = useCallback((projectIds: ReadonlySet<string>) => {
    setExpandedProjectTaskIdsState((currentProjectIds) => {
      if (
        currentProjectIds.size === projectIds.size &&
        [...currentProjectIds].every((projectId) => projectIds.has(projectId))
      ) {
        return currentProjectIds;
      }
      return new Set(projectIds);
    });
  }, []);
  const requestNotificationPermission = useCallback(() => {
    void projectRuntime.requestNotificationPermission();
  }, [projectRuntime]);
  const addProject = useCallback(
    (rootPaths: readonly string[]) =>
      addProjectLockRef.current.run(async () => {
        setIsProjectAddPending(true);
        try {
          const response = await client.addProject(rootPaths);
          // 注册响应已包含完整 Project，直接写入精确缓存，避免重取当前 Task 等无关查询。
          queryClient.setQueryData<ProjectPage>(["projects"], (currentPage) => {
            if (currentPage === undefined) {
              return { data: [response.project], nextCursor: null };
            }
            const existingProjectIndex = currentPage.data.findIndex(
              (project) => project.id === response.project.id,
            );
            if (existingProjectIndex < 0) {
              return { ...currentPage, data: [...currentPage.data, response.project] };
            }
            return {
              ...currentPage,
              data: currentPage.data.map((project, index) =>
                index === existingProjectIndex ? response.project : project,
              ),
            };
          });
          notifyActionSuccess();
          return response.project;
        } catch (error) {
          notifyActionError(error);
          return undefined;
        } finally {
          setIsProjectAddPending(false);
        }
      }),
    [client, queryClient],
  );
  const reorderProjects = useCallback(
    async (projectIds: readonly string[]) =>
      (await projectOrderLockRef.current.run(async () => {
        const currentPage = queryClient.getQueryData<ProjectPage>(["projects"]);
        const optimisticPage = reorderProjectPage(currentPage, projectIds);
        if (optimisticPage === undefined) {
          notifyActionError(
            new Error(i18n.t("errors.reorderProjectChanged", { ns: "conversation" })),
          );
          return false;
        }

        // 拖动释放后立即更新列表；服务端失败时恢复提交前的完整快照。
        queryClient.setQueryData<ProjectPage>(["projects"], optimisticPage);
        try {
          const response = await mutateProjectOrder(projectIds);
          queryClient.setQueryData<ProjectPage>(["projects"], response);
          return true;
        } catch {
          queryClient.setQueryData<ProjectPage>(["projects"], currentPage);
          return false;
        }
      })) ?? false,
    [mutateProjectOrder, queryClient],
  );
  const renameProject = useCallback(
    async (projectId: string, name: string) =>
      (await projectActionLockRef.current.run(async () => {
        try {
          const response = await mutateProjectRename({ name, projectId });
          queryClient.setQueryData<ProjectPage>(["projects"], (currentPage) =>
            currentPage === undefined
              ? undefined
              : {
                  ...currentPage,
                  data: currentPage.data.map((project) =>
                    project.id === projectId ? response.project : project,
                  ),
                },
          );
          return true;
        } catch {
          return false;
        }
      })) ?? false,
    [mutateProjectRename, queryClient],
  );
  const removeProject = useCallback(
    (projectId: string) =>
      projectActionLockRef.current.run(async () => {
        try {
          await mutateProjectRemove(projectId);
          // 先停止该 Project 的请求和实时连接，再从列表移除，避免旧响应回填缓存。
          await queryClient.cancelQueries({ queryKey: ["projects", projectId] });
          queryClient.removeQueries({ queryKey: ["projects", projectId] });
          gitStatusCoordinator.forgetProject(projectId);
          projectRuntime.forgetProject(projectId);
          const currentPage = queryClient.getQueryData<ProjectPage>(["projects"]);
          const remainingProjects =
            currentPage?.data.filter((project) => project.id !== projectId) ?? emptyProjects;
          setSelectedRootIds((current) => {
            if (!current.has(projectId)) return current;
            const next = new Map(current);
            next.delete(projectId);
            return next;
          });
          queryClient.setQueryData<ProjectPage>(
            ["projects"],
            currentPage === undefined ? undefined : { ...currentPage, data: remainingProjects },
          );
          return remainingProjects;
        } catch {
          return undefined;
        }
      }),
    [gitStatusCoordinator, mutateProjectRemove, projectRuntime, queryClient],
  );
  const refreshProjectGitStatus = useCallback(
    async (projectId: string, rootPath: string) => {
      try {
        await gitStatusCoordinator.refreshProject(projectId, rootPath);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
      }
    },
    [gitStatusCoordinator],
  );
  const retry = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  useEffect(
    () => () => {
      projectRuntime.dispose();
      gitStatusCoordinator.dispose();
    },
    [gitStatusCoordinator, projectRuntime],
  );

  const dataValue = useMemo<ProjectDataContextValue>(
    () => ({
      capabilities: capabilitiesQuery.data,
      client,
      error: capabilitiesQuery.error ?? projectsQuery.error,
      isPending,
      projectTaskStates,
      projects,
      tasks,
    }),
    [
      capabilitiesQuery.data,
      capabilitiesQuery.error,
      client,
      isPending,
      projectTaskStates,
      projects,
      projectsQuery.error,
      tasks,
    ],
  );
  const actionsValue = useMemo<ProjectActionsContextValue>(
    () => ({
      addProject,
      fetchNextProjectTaskPage,
      forgetTask,
      markTaskRunning,
      projectRuntime,
      refreshProjectGitStatus,
      removeProject,
      renameProject,
      reorderProjects,
      requestNotificationPermission,
      retry,
      setExpandedProjectTaskIds,
      viewTask,
    }),
    [
      addProject,
      fetchNextProjectTaskPage,
      forgetTask,
      markTaskRunning,
      projectRuntime,
      refreshProjectGitStatus,
      removeProject,
      renameProject,
      reorderProjects,
      requestNotificationPermission,
      retry,
      setExpandedProjectTaskIds,
      viewTask,
    ],
  );
  const activityValue = useMemo<ProjectActivityContextValue>(
    () => ({
      isProjectActionPending: isProjectRenamePending || isProjectRemovePending,
      isProjectOrderPending,
      isProjectAddPending,
      taskActivity,
    }),
    [
      isProjectAddPending,
      isProjectOrderPending,
      isProjectRemovePending,
      isProjectRenamePending,
      taskActivity,
    ],
  );
  const rootSelectionValue = useMemo<ProjectRootSelectionContextValue>(
    () => ({ selectedRootIds, setSelectedProjectRoot }),
    [selectedRootIds, setSelectedProjectRoot],
  );

  return (
    <ProjectProviderView
      actions={actionsValue}
      activity={activityValue}
      client={client}
      data={dataValue}
      onRemoveTaskQuery={removeProjectTaskResult}
      onUpdateTaskQuery={updateProjectTaskResult}
      projects={queriedProjects}
      rootSelection={rootSelectionValue}
    >
      {children}
    </ProjectProviderView>
  );
}
