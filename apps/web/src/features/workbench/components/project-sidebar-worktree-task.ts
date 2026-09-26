import type { CodexlyClient } from "@codexly/client";
import type { AgentTask } from "@codexly/protocol";
import type { QueryClient } from "@tanstack/react-query";

import { upsertProjectTaskInInfiniteData } from "../../projects/project-query-cache.js";
import type { ProjectTaskInfiniteData } from "../../projects/project-query-contracts.js";

export type WorktreeTaskClient = Pick<
  CodexlyClient,
  "createTaskWorktree" | "getProjectGitStatus" | "startWorktreeTask"
>;

export type WorktreeTaskResult =
  | Readonly<{ task: AgentTask; worktreePath: string }>
  | Readonly<{ error: unknown; worktreePath: string }>;

export async function createWorktreeBoundTask(
  client: WorktreeTaskClient,
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  branch: string,
  existingWorktreePath?: string,
): Promise<WorktreeTaskResult> {
  let worktreePath = existingWorktreePath;
  if (worktreePath === undefined) {
    const normalizedBranch = branch.trim();
    if (normalizedBranch.length === 0) throw new Error("Git branch name is required");
    const status = await client.getProjectGitStatus(projectId, { rootPath });
    if (status.repositoryMode !== "root") {
      throw new Error("Git worktree requires a repository root");
    }
    const response = await client.createTaskWorktree(projectId, rootPath, {
      branch: normalizedBranch,
      expectedSnapshot: status.snapshot,
    });
    worktreePath = response.worktree.path;
    // Git 创建成功后立即持有路径；状态刷新不影响任务启动与失败重试。
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, rootPath, "git-worktrees"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, rootPath, "git-status"],
    });
  }

  try {
    const { task } = await client.startWorktreeTask(projectId, { rootPath, worktreePath });
    queryClient.setQueryData(
      ["projects", projectId, "task-workspace-paths", task.id],
      worktreePath,
    );
    queryClient.setQueryData<ProjectTaskInfiniteData>(["projects", projectId, "tasks"], (current) =>
      upsertProjectTaskInInfiniteData(current, task),
    );
    return { task, worktreePath };
  } catch (error) {
    // worktree 已存在时保留路径，重试仅启动任务，不再次创建 Git 分支。
    return { error, worktreePath };
  }
}
