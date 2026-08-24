import { TEMPORARY_TASK_SCOPE_ID, type Project } from "@code-agent/protocol";

import type {
  ProjectGitActivityReason,
  ProjectGitStatusCoordinator,
} from "./project-git-status-coordinator.js";
import { resolveProjectRootFromSelections } from "./project-root-selection.js";

type GitStatusCoordinator = Pick<
  ProjectGitStatusCoordinator,
  "handleActivity" | "handleGitMetadataChanged"
>;

type ProjectGitRuntimeHandlerOptions = Readonly<{
  coordinator: GitStatusCoordinator;
  getProject: (projectId: string) => Pick<Project, "id" | "roots"> | undefined;
  getSelectedRootIds: () => ReadonlyMap<string, string>;
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
      const root = resolveRoot(projectId);
      if (root !== undefined) {
        options.coordinator.handleActivity(projectId, root.path, taskId, reason);
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
