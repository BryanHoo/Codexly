import type { ProjectRoot } from "@codexly/protocol";

export function resolveWorkbenchTaskRoot(
  input: Readonly<{
    projectRoots: readonly ProjectRoot[];
    selectedRoot: ProjectRoot | undefined;
    taskId: string | undefined;
    taskKnown: boolean;
    metadataTaskId: string | undefined;
    reportedWorkspacePath: string | undefined;
    temporary: boolean;
  }>,
) {
  const workspacePath = input.projectRoots.some((root) => root.path === input.reportedWorkspacePath)
    ? undefined
    : input.reportedWorkspacePath;
  const pending =
    input.taskId !== undefined && !input.taskKnown && input.metadataTaskId !== input.taskId;
  if (input.temporary || pending) {
    return {
      activeRootId: undefined,
      projectRoots: input.projectRoots,
      selectedRootPath: undefined,
    };
  }
  if (workspacePath !== undefined) {
    // worktree 任务只有一个固定工作区，避免根选择器切回原仓库。
    return {
      activeRootId: "worktree",
      projectRoots: [{ id: "worktree", path: workspacePath }],
      selectedRootPath: workspacePath,
    };
  }
  return {
    activeRootId: input.selectedRoot?.id,
    projectRoots: input.projectRoots,
    selectedRootPath: input.selectedRoot?.path,
  };
}
