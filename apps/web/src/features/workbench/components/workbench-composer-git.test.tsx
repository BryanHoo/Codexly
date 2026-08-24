import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  createComposerBranch,
  createComposerWorktree,
  switchComposerBranch,
  switchComposerWorktree,
} from "../hooks/use-workbench-branch-switch.js";
import { rootPath } from "./workbench-composer.test-support.js";

describe("WorkbenchComposer Git", () => {
  it("switches a local branch and replaces the shared Git status cache", async () => {
    const queryClient = new QueryClient();
    const currentStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/review",
      branches: ["feat/review", "main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const nextStatus = {
      ...currentStatus,
      baseBranches: ["origin/main", "feat/review"],
      branch: "main",
      branches: ["main", "feat/review"],
      snapshot: "b".repeat(64),
    };
    const client = { switchProjectBranch: vi.fn(() => Promise.resolve(nextStatus)) };
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");

    await expect(
      switchComposerBranch(client, queryClient, "code-agent", rootPath, currentStatus, "main"),
    ).resolves.toBe(true);

    expect(client.switchProjectBranch).toHaveBeenCalledWith("code-agent", rootPath, {
      branch: "main",
      expectedSnapshot: currentStatus.snapshot,
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["projects", "code-agent", rootPath, "git-status"],
    });
    expect(queryClient.getQueryData(["projects", "code-agent", rootPath, "git-status"])).toEqual(
      nextStatus,
    );
  });

  it("does not switch unavailable or already active branches", async () => {
    const queryClient = new QueryClient();
    const client = { switchProjectBranch: vi.fn() };
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    await expect(
      switchComposerBranch(client, queryClient, "code-agent", rootPath, status, "main"),
    ).resolves.toBe(false);
    await expect(
      switchComposerBranch(client, queryClient, "code-agent", rootPath, status, "missing"),
    ).resolves.toBe(false);
    expect(client.switchProjectBranch).not.toHaveBeenCalled();
  });

  it("creates a local branch and replaces the shared Git status cache", async () => {
    const queryClient = new QueryClient();
    const currentStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const nextStatus = {
      ...currentStatus,
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      snapshot: "b".repeat(64),
    };
    const client = { createProjectBranch: vi.fn(() => Promise.resolve(nextStatus)) };
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");

    await expect(
      createComposerBranch(
        client,
        queryClient,
        "code-agent",
        rootPath,
        currentStatus,
        "feat/new-branch",
      ),
    ).resolves.toBe(true);

    expect(client.createProjectBranch).toHaveBeenCalledWith("code-agent", rootPath, {
      branch: "feat/new-branch",
      expectedSnapshot: currentStatus.snapshot,
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["projects", "code-agent", rootPath, "git-status"],
    });
    expect(queryClient.getQueryData(["projects", "code-agent", rootPath, "git-status"])).toEqual(
      nextStatus,
    );
  });

  it("does not create empty, duplicate, or read-only branches", async () => {
    const queryClient = new QueryClient();
    const client = { createProjectBranch: vi.fn() };
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    await expect(
      createComposerBranch(client, queryClient, "code-agent", rootPath, status, ""),
    ).resolves.toBe(false);
    await expect(
      createComposerBranch(client, queryClient, "code-agent", rootPath, status, "main"),
    ).resolves.toBe(false);
    await expect(
      createComposerBranch(
        client,
        queryClient,
        "code-agent",
        rootPath,
        { ...status, repositoryMode: "children" },
        "feat/new",
      ),
    ).resolves.toBe(false);
    expect(client.createProjectBranch).not.toHaveBeenCalled();
  });

  it("creates a worktree and writes its target project into shared caches", async () => {
    const queryClient = new QueryClient();
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const response = {
      project: {
        createdAt: "2026-08-18T00:00:00.000Z",
        id: "code-agent-worktree",
        name: "CodeAgent-feat-review",
        roots: [{ id: "root-review", path: "/workspace/CodeAgent-feat-review" }],
      },
      worktree: {
        branch: "feat/review",
        current: false,
        path: "/workspace/CodeAgent-feat-review",
      },
    };
    const client = { createProjectWorktree: vi.fn(() => Promise.resolve(response)) };

    await expect(
      createComposerWorktree(client, queryClient, "code-agent", rootPath, status, " feat/review "),
    ).resolves.toEqual(response.project);

    expect(client.createProjectWorktree).toHaveBeenCalledWith("code-agent", rootPath, {
      branch: "feat/review",
      expectedSnapshot: status.snapshot,
    });
    expect(queryClient.getQueryData(["projects"])).toEqual({
      data: [response.project],
      nextCursor: null,
    });
    expect(queryClient.getQueryData(["projects", "code-agent", rootPath, "git-worktrees"])).toEqual(
      {
        worktrees: [response.worktree],
      },
    );
  });

  it("switches only to a listed non-current worktree", async () => {
    const queryClient = new QueryClient();
    const worktree = {
      branch: "feat/review",
      current: false,
      path: "/workspace/CodeAgent-feat-review",
    };
    const response = {
      project: {
        createdAt: "2026-08-18T00:00:00.000Z",
        id: "code-agent-worktree",
        name: "CodeAgent-feat-review",
        roots: [{ id: "root-worktree", path: worktree.path }],
      },
      worktree,
    };
    const client = { switchProjectWorktree: vi.fn(() => Promise.resolve(response)) };

    await expect(
      switchComposerWorktree(
        client,
        queryClient,
        "code-agent",
        rootPath,
        [worktree],
        worktree.path,
      ),
    ).resolves.toEqual(response.project);
    await expect(
      switchComposerWorktree(
        client,
        queryClient,
        "code-agent",
        rootPath,
        [worktree],
        "/workspace/missing",
      ),
    ).resolves.toBeUndefined();

    expect(client.switchProjectWorktree).toHaveBeenCalledOnce();
    expect(client.switchProjectWorktree).toHaveBeenCalledWith("code-agent", rootPath, {
      path: worktree.path,
    });
  });
});
