import { describe, expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse, projectRootPath } from "./http-client.test-support.js";

describe("CodexlyClient task worktrees", () => {
  it("creates a task worktree and starts the task under the original Project", async () => {
    const worktreePath = "/workspace/Codexly-feature";
    const worktree = { branch: "feature", current: false, path: worktreePath };
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "project one",
      title: "新聊天",
      updatedAt: "2026-09-26T00:00:00.000Z",
      workspacePath: worktreePath,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ worktree }))
      .mockResolvedValueOnce(jsonResponse({ task }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.createTaskWorktree("project one", projectRootPath, {
        branch: "feature",
        expectedSnapshot: "a".repeat(64),
      }),
    ).resolves.toEqual({ worktree });
    await expect(
      client.startWorktreeTask("project one", {
        rootPath: projectRootPath,
        worktreePath,
      }),
    ).resolves.toEqual({ task });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/git/task-worktrees?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects/project%20one/tasks");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ rootPath: projectRootPath, worktreePath }),
      method: "POST",
    });
  });
});
