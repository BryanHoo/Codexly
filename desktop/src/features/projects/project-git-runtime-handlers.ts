import { TEMPORARY_TASK_SCOPE_ID, type Project } from "@/protocol/index.js";
import type { ProjectPage } from "@/protocol/index.js";
import type { QueryClient } from "@tanstack/react-query";
import type { ProjectTaskInfiniteData } from "./project-query-contracts.js";

import type {
  ProjectGitActivityReason,
  ProjectGitStatusCoordinator,
} from "./project-git-status-coordinator.js";
import { resolveProjectRootFromSelections } from "./project-root-selection.js";

type GitStatusCoordinator = Pick<
  ProjectGitStatusCoordinator,
  "handleActivity" | "handleGitMetadataChanged"
>;

export function createCachedProjectGitRuntimeHandlers(
  coordinator: GitStatusCoordinator,
  queryClient: QueryClient,
  getSelectedRootIds: () => ReadonlyMap<string, string>,
) {
  return createProjectGitRuntimeHandlers({
    coordinator,
    getSelectedRootIds,
    getProject: (projectId) =>
      queryClient
        .getQueryData<ProjectPage>(["projects"])
        ?.data.find((project) => project.id === projectId),
    getTaskWorkspacePath: (projectId, taskId) =>
      queryClient.getQueryData<string>(["projects", projectId, "task-workspace-paths", taskId]) ??
      queryClient
        .getQueryData<ProjectTaskInfiniteData>(["projects", projectId, "tasks"])
        ?.pages.flatMap((page) => page.data)
        .find((task) => task.id === taskId)?.workspacePath,
  });
}

type ProjectGitRuntimeHandlerOptions = Readonly<{
  coordinator: GitStatusCoordinator;
  getProject: (projectId: string) => Pick<Project, "id" | "roots"> | undefined;
  getSelectedRootIds: () => ReadonlyMap<string, string>;
  getTaskWorkspacePath?: (projectId: string, taskId: string) => string | undefined;
}>;

export function createProjectGitRuntimeHandlers(options: ProjectGitRuntimeHandlerOptions) {
  const resolveRoot = (projectId: string) =>
    resolveProjectRootFromSelections(options.getProject(projectId), options.getSelectedRootIds());

  return {
    onProjectGitActivity(
      projectId: string,
      taskId: string,
      reason: ProjectGitActivityReason,
    ): void {
      if (projectId === TEMPORARY_TASK_SCOPE_ID) return;
      const project = options.getProject(projectId);
      const workspacePath = options.getTaskWorkspacePath?.(projectId, taskId);
      // 普通任务仍跟随用户选中的 Project root；只有外部 worktree 固定目录。
      const rootPath =
        workspacePath !== undefined && !project?.roots.some((root) => root.path === workspacePath)
          ? workspacePath
          : resolveRoot(projectId)?.path;
      if (rootPath !== undefined) {
        options.coordinator.handleActivity(projectId, rootPath, taskId, reason);
      }
    },
    onProjectGitMetadataChanged(projectId: string, rootPath: string): void {
      const root = resolveRoot(projectId);
      if (root?.path === rootPath) {
        options.coordinator.handleGitMetadataChanged(projectId, rootPath);
      }
    },
  } as const;
}
