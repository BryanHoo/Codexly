import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  createComposerBranch,
  switchComposerBranch,
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
      switchComposerBranch(client, queryClient, "codexly", rootPath, currentStatus, "main"),
    ).resolves.toBe(true);

    expect(client.switchProjectBranch).toHaveBeenCalledWith("codexly", rootPath, {
      branch: "main",
      expectedSnapshot: currentStatus.snapshot,
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["projects", "codexly", rootPath, "git-status"],
    });
    expect(queryClient.getQueryData(["projects", "codexly", rootPath, "git-status"])).toEqual(
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
      switchComposerBranch(client, queryClient, "codexly", rootPath, status, "main"),
    ).resolves.toBe(false);
    await expect(
      switchComposerBranch(client, queryClient, "codexly", rootPath, status, "missing"),
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
        "codexly",
        rootPath,
        currentStatus,
        "feat/new-branch",
      ),
    ).resolves.toBe(true);

    expect(client.createProjectBranch).toHaveBeenCalledWith("codexly", rootPath, {
      branch: "feat/new-branch",
      expectedSnapshot: currentStatus.snapshot,
    });
    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: ["projects", "codexly", rootPath, "git-status"],
    });
    expect(queryClient.getQueryData(["projects", "codexly", rootPath, "git-status"])).toEqual(
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
      createComposerBranch(client, queryClient, "codexly", rootPath, status, ""),
    ).resolves.toBe(false);
    await expect(
      createComposerBranch(client, queryClient, "codexly", rootPath, status, "main"),
    ).resolves.toBe(false);
    await expect(
      createComposerBranch(
        client,
        queryClient,
        "codexly",
        rootPath,
        { ...status, repositoryMode: "children" },
        "feat/new",
      ),
    ).resolves.toBe(false);
    expect(client.createProjectBranch).not.toHaveBeenCalled();
  });
});
