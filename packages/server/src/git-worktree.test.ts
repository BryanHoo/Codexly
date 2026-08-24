import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectWorktree,
  GitWorktreeError,
  parseGitWorktreeList,
  resolveProjectWorktree,
} from "./git-worktree.js";

const temporaryRoots: string[] = [];

async function createRepositoryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code-agent-git-worktree-test-")));
  temporaryRoots.push(root);
  await mkdir(join(root, ".git"));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("parseGitWorktreeList", () => {
  it("parses NUL-delimited branch and detached worktrees", () => {
    const currentPath = "/workspace/CodeAgent";
    const output = [
      `worktree ${currentPath}`,
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
      "worktree /workspace/CodeAgent-review",
      `HEAD ${"b".repeat(40)}`,
      "detached",
      "",
    ].join("\0");

    expect(parseGitWorktreeList(output, currentPath)).toEqual([
      { branch: "main", current: true, path: currentPath },
      { branch: null, current: false, path: "/workspace/CodeAgent-review" },
    ]);
  });
});

describe("createProjectWorktree", () => {
  it("creates an existing branch in a unique sibling directory", async () => {
    const projectRoot = await createRepositoryRoot();
    const defaultTarget = join(dirname(projectRoot), `${basename(projectRoot)}-feat-review`);
    await mkdir(defaultTarget);
    temporaryRoots.push(defaultTarget);
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) => {
      if (arguments_[0] === "check-ref-format") return Promise.resolve("feat/review\n");
      if (arguments_[0] === "worktree") return Promise.resolve("");
      throw new Error(`Unexpected Git command: ${arguments_.join(" ")}`);
    });
    const readStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["origin/main"],
        branch: "main",
        branches: ["main", "feat/review"],
        repositoryMode: "root" as const,
        snapshot: "a".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );

    const worktree = await createProjectWorktree(
      projectRoot,
      { branch: "feat/review", expectedSnapshot: "a".repeat(64) },
      executeGit,
      readStatus,
    );

    expect(worktree).toEqual({
      branch: "feat/review",
      current: false,
      path: `${defaultTarget}-2`,
    });
    expect(executeGit).toHaveBeenNthCalledWith(1, projectRoot, [
      "check-ref-format",
      "--branch",
      "feat/review",
    ]);
    expect(executeGit).toHaveBeenNthCalledWith(2, projectRoot, [
      "worktree",
      "add",
      "--",
      `${defaultTarget}-2`,
      "feat/review",
    ]);
  });

  it("creates a new branch from HEAD and rejects stale or read-only status", async () => {
    const projectRoot = await createRepositoryRoot();
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) =>
      Promise.resolve(arguments_[0] === "check-ref-format" ? "feat/new\n" : ""),
    );

    await createProjectWorktree(
      projectRoot,
      { branch: "feat/new", expectedSnapshot: status.snapshot },
      executeGit,
      () => Promise.resolve(status),
    );

    expect(executeGit).toHaveBeenLastCalledWith(projectRoot, [
      "worktree",
      "add",
      "-b",
      "feat/new",
      "--",
      expect.stringContaining(`${basename(projectRoot)}-feat-new`),
      "HEAD",
    ]);

    for (const [nextStatus, expectedSnapshot, code] of [
      [status, "b".repeat(64), "SNAPSHOT_MISMATCH"],
      [{ ...status, repositoryMode: "children" as const }, status.snapshot, "REPOSITORY_READ_ONLY"],
    ] as const) {
      await expect(
        createProjectWorktree(projectRoot, { branch: "feat/new", expectedSnapshot }, vi.fn(), () =>
          Promise.resolve(nextStatus),
        ),
      ).rejects.toMatchObject({ code });
    }
  });

  it("preserves invalid branch and worktree creation failures", async () => {
    const projectRoot = await createRepositoryRoot();
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
      createProjectWorktree(
        projectRoot,
        { branch: "invalid name", expectedSnapshot: status.snapshot },
        () => Promise.reject(new Error("fatal: invalid branch name")),
        () => Promise.resolve(status),
      ),
    ).rejects.toMatchObject({ code: "INVALID_BRANCH_NAME" });

    const executeGit = vi
      .fn()
      .mockResolvedValueOnce("feat/new\n")
      .mockRejectedValueOnce(new Error("fatal: worktree path is locked"));
    await expect(
      createProjectWorktree(
        projectRoot,
        { branch: "feat/new", expectedSnapshot: status.snapshot },
        executeGit,
        () => Promise.resolve(status),
      ),
    ).rejects.toEqual(new GitWorktreeError("CREATE_FAILED", "fatal: worktree path is locked"));
  });
});

describe("resolveProjectWorktree", () => {
  it("accepts only another worktree returned by the current repository", async () => {
    const projectRoot = await createRepositoryRoot();
    const targetRoot = await realpath(
      await mkdtemp(join(tmpdir(), "code-agent-git-worktree-target-test-")),
    );
    temporaryRoots.push(targetRoot);
    const worktrees = [
      { branch: "main", current: true, path: projectRoot },
      { branch: "feat/review", current: false, path: targetRoot },
    ];

    await expect(
      resolveProjectWorktree(projectRoot, targetRoot, () => Promise.resolve({ worktrees })),
    ).resolves.toEqual(worktrees[1]);
    await expect(
      resolveProjectWorktree(projectRoot, projectRoot, () => Promise.resolve({ worktrees })),
    ).rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
    await expect(
      resolveProjectWorktree(projectRoot, dirname(projectRoot), () =>
        Promise.resolve({ worktrees }),
      ),
    ).rejects.toMatchObject({ code: "WORKTREE_NOT_FOUND" });
  });
});
