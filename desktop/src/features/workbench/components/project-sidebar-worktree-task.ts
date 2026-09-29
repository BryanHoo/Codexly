import { createWorktreeTask } from "@codexly/frontend-core";
import type { NativeClient } from "@/platform/native-client-contract.js";
import type { AgentTask } from "@codexly/protocol";
import type { QueryClient } from "@tanstack/react-query";

import { upsertProjectTaskInInfiniteData } from "../../projects/project-query-cache.js";
import type { ProjectTaskInfiniteData } from "../../projects/project-query-contracts.js";

export type WorktreeTaskClient = Pick<
  NativeClient,
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
  const result = await createWorktreeTask(
    client,
    {
      projectId,
      rootPath,
      branch,
      ...(existingWorktreePath === undefined ? {} : { existingWorktreePath }),
    },
    () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, rootPath, "git-worktrees"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, rootPath, "git-status"],
      });
    },
  );
  if ("task" in result) {
    queryClient.setQueryData(
      ["projects", projectId, "task-workspace-paths", result.task.id],
      result.worktreePath,
    );
    queryClient.setQueryData<ProjectTaskInfiniteData>(["projects", projectId, "tasks"], (current) =>
      upsertProjectTaskInInfiniteData(current, result.task),
    );
  }
  return result;
}
