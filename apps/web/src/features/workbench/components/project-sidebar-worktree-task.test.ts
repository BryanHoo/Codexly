import { QueryClient } from "@tanstack/react-query";
import type { ProjectGitStatus } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { createWorktreeBoundTask } from "./project-sidebar-worktree-task.js";

const rootPath = "/workspace/Codexly";
const worktreePath = "/workspace/Codexly-feature";
const status = {
  baseBranches: ["main"],
  branch: "main",
  branches: ["main"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [],
} satisfies ProjectGitStatus;
const task = {
  id: "task-1",
  pinned: false,
  projectId: "source-project",
  title: "新聊天",
  updatedAt: "2026-09-26T00:00:00.000Z",
  workspacePath: worktreePath,
};

describe("createWorktreeBoundTask", () => {
  it("把 worktree 任务缓存到原 Project", async () => {
    const queryClient = new QueryClient();
    const client = {
      getProjectGitStatus: vi.fn().mockResolvedValue(status),
      createTaskWorktree: vi.fn().mockResolvedValue({
        status,
        worktree: { branch: "feature", current: false, path: worktreePath },
        worktrees: { worktrees: [] },
      }),
      startWorktreeTask: vi.fn().mockResolvedValue({ task }),
    };

    await expect(
      createWorktreeBoundTask(client, queryClient, task.projectId, rootPath, "feature"),
    ).resolves.toEqual({ task, worktreePath });
    expect(client.createTaskWorktree).toHaveBeenCalledWith(task.projectId, rootPath, {
      branch: "feature",
      expectedSnapshot: status.snapshot,
    });
    expect(client.startWorktreeTask).toHaveBeenCalledWith(task.projectId, {
      rootPath,
      worktreePath,
    });
    expect(
      queryClient.getQueryData<{ pages: { data: (typeof task)[] }[] }>([
        "projects",
        task.projectId,
        "tasks",
      ])?.pages[0]?.data,
    ).toEqual([task]);
    expect(queryClient.getQueryData(["projects"])).toBeUndefined();
  });

  it("启动失败后重试现有 worktree，不再创建分支", async () => {
    const queryClient = new QueryClient();
    const client = {
      getProjectGitStatus: vi.fn().mockResolvedValue(status),
      createTaskWorktree: vi.fn().mockResolvedValue({
        status,
        worktree: { branch: "feature", current: false, path: worktreePath },
        worktrees: { worktrees: [] },
      }),
      startWorktreeTask: vi
        .fn()
        .mockRejectedValueOnce(new Error("Task start failed"))
        .mockResolvedValueOnce({ task }),
    };
    const first = await createWorktreeBoundTask(
      client,
      queryClient,
      task.projectId,
      rootPath,
      "feature",
    );
    expect(first).toMatchObject({ error: new Error("Task start failed"), worktreePath });
    await expect(
      createWorktreeBoundTask(
        client,
        queryClient,
        task.projectId,
        rootPath,
        "feature",
        worktreePath,
      ),
    ).resolves.toEqual({ task, worktreePath });
    expect(client.createTaskWorktree).toHaveBeenCalledTimes(1);
  });
});
