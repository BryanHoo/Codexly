interface WorktreeTaskClient<Task> {
  getProjectGitStatus(
    projectId: string,
    input: { rootPath: string },
  ): Promise<{ repositoryMode: string; snapshot: string }>;
  createTaskWorktree(
    projectId: string,
    rootPath: string,
    input: { branch: string; expectedSnapshot: string },
  ): Promise<{ worktree: { path: string } }>;
  startWorktreeTask(
    projectId: string,
    input: { rootPath: string; worktreePath: string },
  ): Promise<{ task: Task }>;
}

/** 两端共用创建与重试顺序；缓存更新由各端适配层负责。 */
export async function createWorktreeTask<Task>(
  client: WorktreeTaskClient<Task>,
  input: { projectId: string; rootPath: string; branch: string; existingWorktreePath?: string },
  onWorktreeCreated: () => void,
): Promise<{ task: Task; worktreePath: string } | { error: unknown; worktreePath: string }> {
  const { projectId, rootPath } = input;
  let worktreePath = input.existingWorktreePath;
  if (worktreePath === undefined) {
    const branch = input.branch.trim();
    if (!branch) throw new Error("Git branch name is required");
    const status = await client.getProjectGitStatus(projectId, { rootPath });
    if (status.repositoryMode !== "root")
      throw new Error("Git worktree requires a repository root");
    const response = await client.createTaskWorktree(projectId, rootPath, {
      branch,
      expectedSnapshot: status.snapshot,
    });
    worktreePath = response.worktree.path;
    onWorktreeCreated();
  }
  try {
    const { task } = await client.startWorktreeTask(projectId, { rootPath, worktreePath });
    return { task, worktreePath };
  } catch (error) {
    // 保留已经创建的目录，后续重试只启动任务，避免重复创建分支。
    return { error, worktreePath };
  }
}
