import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProjectBranch, GitBranchError, switchProjectBranch } from "./git-branch.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const temporaryRoots: string[] = [];

async function createRepositoryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-branch-test-")));
  temporaryRoots.push(root);
  await mkdir(join(root, ".git"));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("switchProjectBranch", () => {
  it("switches only to a local branch from the expected snapshot", async () => {
    const projectRoot = await createRepositoryRoot();
    let currentBranch = "main";
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) => {
      if (arguments_[0] === "status") {
        return Promise.resolve("");
      }
      if (arguments_[0] === "branch") {
        return Promise.resolve(`${currentBranch}\n`);
      }
      if (arguments_[0] === "for-each-ref") {
        return Promise.resolve(
          arguments_.includes("refs/remotes")
            ? "main\nfeat/switch\norigin/main\n"
            : "main\nfeat/switch\n",
        );
      }
      if (arguments_[0] === "symbolic-ref") {
        return Promise.resolve("refs/remotes/origin/main\n");
      }
      if (arguments_[0] === "switch") {
        currentBranch = arguments_[2] ?? currentBranch;
        return Promise.resolve("");
      }
      throw new Error(`Unexpected Git command: ${arguments_.join(" ")}`);
    });
    const initial = await readGitWorkingTreeStatus(projectRoot, executeGit);

    const result = await switchProjectBranch(
      projectRoot,
      { branch: "feat/switch", expectedSnapshot: initial.snapshot },
      executeGit,
    );

    expect(executeGit).toHaveBeenCalledWith(projectRoot, ["switch", "--no-guess", "feat/switch"]);
    expect(result.branch).toBe("feat/switch");
  });

  it("rejects stale, unknown, active, and read-only branch switches before mutation", async () => {
    const projectRoot = await createRepositoryRoot();
    const rootStatus = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main", "feat/switch"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) =>
      Promise.resolve(arguments_[0] === "check-ref-format" ? `${arguments_[2] ?? ""}\n` : ""),
    );

    for (const [request, status, code] of [
      [
        { branch: "feat/switch", expectedSnapshot: "b".repeat(64) },
        rootStatus,
        "SNAPSHOT_MISMATCH",
      ],
      [
        { branch: "missing", expectedSnapshot: rootStatus.snapshot },
        rootStatus,
        "BRANCH_NOT_FOUND",
      ],
      [{ branch: "main", expectedSnapshot: rootStatus.snapshot }, rootStatus, "ALREADY_ACTIVE"],
      [
        { branch: "feat/switch", expectedSnapshot: rootStatus.snapshot },
        { ...rootStatus, repositoryMode: "children" as const },
        "REPOSITORY_READ_ONLY",
      ],
    ] as const) {
      await expect(
        switchProjectBranch(projectRoot, request, executeGit, () => Promise.resolve(status)),
      ).rejects.toMatchObject({ code });
    }

    expect(executeGit).not.toHaveBeenCalled();
  });

  it("preserves Git command failure output", async () => {
    const projectRoot = await createRepositoryRoot();
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main", "feat/switch"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    await expect(
      switchProjectBranch(
        projectRoot,
        { branch: "feat/switch", expectedSnapshot: status.snapshot },
        () => Promise.reject(new Error("fatal: /private/worktree conflict")),
        () => Promise.resolve(status),
      ),
    ).rejects.toEqual(new GitBranchError("SWITCH_FAILED", "fatal: /private/worktree conflict"));
  });
});

describe("createProjectBranch", () => {
  it("validates, creates, and switches to a new local branch", async () => {
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
    const createdStatus = {
      ...status,
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      snapshot: "b".repeat(64),
    };
    const readStatus = vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce(createdStatus);
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) =>
      Promise.resolve(arguments_[0] === "check-ref-format" ? `${arguments_[2] ?? ""}\n` : ""),
    );

    await expect(
      createProjectBranch(
        projectRoot,
        { branch: "feat/new-branch", expectedSnapshot: status.snapshot },
        executeGit,
        readStatus,
      ),
    ).resolves.toEqual(createdStatus);

    expect(executeGit).toHaveBeenNthCalledWith(1, projectRoot, [
      "check-ref-format",
      "--branch",
      "feat/new-branch",
    ]);
    expect(executeGit).toHaveBeenNthCalledWith(2, projectRoot, ["switch", "-c", "feat/new-branch"]);
  });

  it("rejects stale, duplicate, read-only, invalid, and failed branch creation", async () => {
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

    for (const [request, nextStatus, code] of [
      [{ branch: "feat/new", expectedSnapshot: "b".repeat(64) }, status, "SNAPSHOT_MISMATCH"],
      [{ branch: "main", expectedSnapshot: status.snapshot }, status, "BRANCH_ALREADY_EXISTS"],
      [
        { branch: "feat/new", expectedSnapshot: status.snapshot },
        { ...status, repositoryMode: "children" as const },
        "REPOSITORY_READ_ONLY",
      ],
    ] as const) {
      const executeGit = vi.fn(() => Promise.resolve(""));
      await expect(
        createProjectBranch(projectRoot, request, executeGit, () => Promise.resolve(nextStatus)),
      ).rejects.toMatchObject({ code });
      expect(executeGit).not.toHaveBeenCalled();
    }

    await expect(
      createProjectBranch(
        projectRoot,
        { branch: "invalid name", expectedSnapshot: status.snapshot },
        () => Promise.reject(new Error("fatal: invalid branch name")),
        () => Promise.resolve(status),
      ),
    ).rejects.toMatchObject({ code: "INVALID_BRANCH_NAME" });

    await expect(
      createProjectBranch(
        projectRoot,
        { branch: "@{-1}", expectedSnapshot: status.snapshot },
        () => Promise.resolve("main\n"),
        () => Promise.resolve(status),
      ),
    ).rejects.toMatchObject({ code: "INVALID_BRANCH_NAME" });

    const executeGit = vi
      .fn()
      .mockResolvedValueOnce("feat/new\n")
      .mockRejectedValueOnce(new Error("fatal: cannot lock ref /private/path"));
    await expect(
      createProjectBranch(
        projectRoot,
        { branch: "feat/new", expectedSnapshot: status.snapshot },
        executeGit,
        () => Promise.resolve(status),
      ),
    ).rejects.toEqual(new GitBranchError("CREATE_FAILED", "fatal: cannot lock ref /private/path"));
  });
});
