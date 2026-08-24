import {
  TEMPORARY_TASK_SCOPE_ID,
  type AgentCapabilities,
  type AgentTask,
  type AgentTaskPage,
  type Project,
} from "@code-agent/protocol";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import type { ProjectRuntimeManager } from "../conversation/runtime/project-runtime.js";
import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";
import {
  flattenProjectTaskPages,
  projectPinnedTasksQueryOptions,
  projectTaskSearchSourceQueryOptions,
  projectTasksInfiniteQueryOptions,
  type CodeAgentWorkbenchClient,
  type ProjectTaskInfiniteData,
} from "./project-queries.js";

const emptyTasks: readonly AgentTask[] = [];

export type ProjectTaskListState = Readonly<{
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
}>;

export type ProjectTaskPageController = Readonly<{
  fetchNextPage: () => Promise<unknown>;
}>;

export type ProjectTaskQueryResult = Readonly<{
  controller: ProjectTaskPageController;
  state: ProjectTaskListState;
  tasks: readonly AgentTask[];
}>;

const pendingProjectTaskState: ProjectTaskListState = {
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  isPending: true,
};

export async function requestNextProjectTaskPage(
  projectTaskControllers: ReadonlyMap<string, ProjectTaskPageController>,
  projectId: string,
): Promise<void> {
  await projectTaskControllers.get(projectId)?.fetchNextPage();
}

export type ProjectDataContextValue = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  error: Error | null;
  isPending: boolean;
  projectTaskStates: ReadonlyMap<string, ProjectTaskListState>;
  projects: readonly Project[];
  tasks: readonly AgentTask[];
}>;

export type ProjectActionsContextValue = Readonly<{
  addProject: (rootPaths: readonly string[]) => Promise<Project | undefined>;
  fetchNextProjectTaskPage: (projectId: string) => Promise<void>;
  forgetTask: (projectId: string, taskId: string) => void;
  markTaskRunning: (projectId: string, taskId: string) => void;
  projectRuntime: ProjectRuntimeManager;
  requestNotificationPermission: () => void;
  reorderProjects: (projectIds: readonly string[]) => Promise<boolean>;
  removeProject: (projectId: string) => Promise<readonly Project[] | undefined>;
  renameProject: (projectId: string, name: string) => Promise<boolean>;
  refreshProjectGitStatus: (projectId: string, rootPath: string) => Promise<void>;
  retry: () => Promise<void>;
  setExpandedProjectTaskIds: (projectIds: ReadonlySet<string>) => void;
  viewTask: (projectId: string, taskId?: string) => void;
}>;

export type ProjectActivityContextValue = Readonly<{
  isProjectActionPending: boolean;
  isProjectOrderPending: boolean;
  isProjectAddPending: boolean;
  taskActivity: TaskActivityMap;
}>;

export type ProjectRootSelectionContextValue = Readonly<{
  selectedRootIds: ReadonlyMap<string, string>;
  setSelectedProjectRoot: (projectId: string, rootId: string) => void;
}>;

export const ProjectDataContext = createContext<ProjectDataContextValue | undefined>(undefined);
export const ProjectActionsContext = createContext<ProjectActionsContextValue | undefined>(
  undefined,
);
export const ProjectActivityContext = createContext<ProjectActivityContextValue | undefined>(
  undefined,
);
export const ProjectRootSelectionContext = createContext<
  ProjectRootSelectionContextValue | undefined
>(undefined);

export type ProjectTaskQueryProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  onRemove: (projectId: string) => void;
  onUpdate: (projectId: string, result: ProjectTaskQueryResult) => void;
  projectId: string;
}>;

export function ProjectTaskQuery({ client, onRemove, onUpdate, projectId }: ProjectTaskQueryProps) {
  const query = useInfiniteQuery<
    AgentTaskPage,
    Error,
    ProjectTaskInfiniteData,
    readonly ["projects", string, "tasks"],
    string | undefined
  >(projectTasksInfiniteQueryOptions(projectId, client));
  const tasks = useMemo(() => flattenProjectTaskPages(query.data), [query.data]);

  useEffect(() => {
    onUpdate(projectId, {
      controller: { fetchNextPage: query.fetchNextPage },
      state: {
        error: query.error,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        isPending: query.isPending,
      },
      tasks,
    });
  }, [
    onUpdate,
    projectId,
    query.error,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.isPending,
    tasks,
  ]);

  useEffect(
    () => () => {
      onRemove(projectId);
    },
    [onRemove, projectId],
  );

  return null;
}

export function buildTaskScopeCollections(
  queriedTaskScopeIds: readonly string[],
  projectTaskResults: ReadonlyMap<string, ProjectTaskQueryResult>,
) {
  const tasks = queriedTaskScopeIds.flatMap(
    (projectId) => projectTaskResults.get(projectId)?.tasks ?? emptyTasks,
  );
  const projectTaskStates = new Map(
    queriedTaskScopeIds.map((projectId) => [
      projectId,
      projectTaskResults.get(projectId)?.state ?? pendingProjectTaskState,
    ]),
  );

  return { projectTaskStates, tasks } as const;
}
export function useProjectData() {
  const context = useContext(ProjectDataContext);
  if (context === undefined) {
    throw new Error("useProjectData must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectActions() {
  const context = useContext(ProjectActionsContext);
  if (context === undefined) {
    throw new Error("useProjectActions must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectActivity() {
  const context = useContext(ProjectActivityContext);
  if (context === undefined) {
    throw new Error("useProjectActivity must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectRootSelection() {
  const context = useContext(ProjectRootSelectionContext);
  if (context === undefined) {
    throw new Error("useProjectRootSelection must be used inside ProjectProvider");
  }
  return context;
}

export function useProjectTaskSearch(normalizedQuery: string) {
  const { client, projects } = useProjectData();
  const isSearchEnabled = normalizedQuery.length > 0;
  const taskScopeIds = [TEMPORARY_TASK_SCOPE_ID, ...projects.map((project) => project.id)];
  const searchQueries = useQueries({
    queries: taskScopeIds.map((projectId) =>
      projectTaskSearchSourceQueryOptions(projectId, isSearchEnabled, client),
    ),
  });
  const isPending = isSearchEnabled && searchQueries.some((query) => query.isPending);
  const error = searchQueries.find((query) => query.error !== null)?.error ?? null;

  // 所有 Project 的搜索源完成后再发布结果，避免把“尚未加载”误报为“没有匹配”。
  const tasks =
    isPending || error !== null
      ? emptyTasks
      : searchQueries
          .flatMap((query) => query.data ?? emptyTasks)
          .filter((task) => task.title.toLocaleLowerCase().includes(normalizedQuery));

  return { error, isPending, tasks } as const;
}

export function usePinnedProjectTasks() {
  const { client, projects } = useProjectData();
  const taskScopeIds = [TEMPORARY_TASK_SCOPE_ID, ...projects.map((project) => project.id)];
  // 各 Project 并行读取原生固定列表，单个 Project 内由 Query 顺序追踪全部 Cursor。
  const pinnedQueries = useQueries({
    queries: taskScopeIds.map((projectId) => projectPinnedTasksQueryOptions(projectId, client)),
  });

  return {
    error: pinnedQueries.find((query) => query.error !== null)?.error ?? null,
    isPending: pinnedQueries.some((query) => query.isPending),
    tasks: pinnedQueries.flatMap((query) => query.data ?? emptyTasks),
  } as const;
}
