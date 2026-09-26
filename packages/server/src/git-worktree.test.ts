import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectWorktree,
  GitWorktreeError,
  parseGitWorktreeList,
  resolveProjectWorktree,
} from "./git-worktree.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const temporaryRoots: string[] = [];

async function createRepositoryRoot(): Promise<string> {
  const container = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-worktree-test-")));
  temporaryRoots.push(container);
  const root = join(container, "source");
  await mkdir(join(root, ".git"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("parseGitWorktreeList", () => {
  it("parses NUL-delimited branch and detached worktrees", () => {
    const currentPath = "/workspace/Codexly";
    const output = [
      `worktree ${currentPath}`,
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
      "worktree /workspace/Codexly-review",
      `HEAD ${"b".repeat(40)}`,
      "detached",
      "",
    ].join("\0");

    expect(parseGitWorktreeList(output, currentPath)).toEqual([
      { branch: "main", current: true, path: currentPath },
      { branch: null, current: false, path: "/workspace/Codexly-review" },
    ]);
  });
});

describe("createProjectWorktree", () => {
  it("creates a real Git worktree beside the main worktree", async () => {
    const container = await realpath(await mkdtemp(join(tmpdir(), "codexly-real-worktree-")));
    temporaryRoots.push(container);
    const mainRoot = join(container, "main");
    const linkedRoot = join(container, "nested", "linked");
    const git = async (...args: string[]) => {
      await promisify(execFile)("git", ["-C", mainRoot, ...args]);
    };
    await promisify(execFile)("git", ["init", mainRoot]);
    await git("config", "user.name", "Codexly Test");
    await git("config", "user.email", "test@example.com");
    await writeFile(join(mainRoot, "README.md"), "main\n");
    await git("add", "README.md");
    await git("commit", "-m", "initial");
    await mkdir(dirname(linkedRoot), { recursive: true });
    await git("worktree", "add", "-b", "linked", linkedRoot, "HEAD");
    const status = await readGitWorkingTreeStatus(linkedRoot);

    const created = await createProjectWorktree(linkedRoot, {
      branch: "feature",
      expectedSnapshot: status.snapshot,
    });

    expect(created.path).toBe(join(container, "feature"));
    expect(
      (await promisify(execFile)("git", ["-C", mainRoot, "worktree", "list", "--porcelain"]))
        .stdout,
    ).toContain(`worktree ${created.path}`);
  });

  it("creates an existing branch in a unique sibling directory", async () => {
    const projectRoot = await createRepositoryRoot();
    const defaultTarget = join(dirname(projectRoot), "feat-review");
    await mkdir(defaultTarget);
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) => {
      if (arguments_[0] === "check-ref-format") return Promise.resolve("feat/review\n");
      if (arguments_[0] === "worktree" && arguments_[1] === "list") {
        return Promise.resolve(`worktree ${projectRoot}\0HEAD ${"a".repeat(40)}\0\0`);
      }
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
    expect(executeGit).toHaveBeenNthCalledWith(3, projectRoot, [
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
      Promise.resolve(
        arguments_[0] === "check-ref-format"
          ? "feat/new\n"
          : arguments_[1] === "list"
            ? `worktree ${projectRoot}\0HEAD ${"a".repeat(40)}\0\0`
            : "",
      ),
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
      join(dirname(projectRoot), "feat-new"),
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

  it("places new worktrees beside the main worktree when started from a linked worktree", async () => {
    const mainRoot = await createRepositoryRoot();
    const linkedRoot = join(dirname(mainRoot), "nested", "linked");
    await mkdir(linkedRoot, { recursive: true });
    const output = [
      `worktree ${mainRoot}`,
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
      `worktree ${linkedRoot}`,
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/linked",
      "",
    ].join("\0");
    const executeGit = vi.fn((_root: string, args: readonly string[]) => {
      if (args[0] === "check-ref-format") return Promise.resolve("feat/next\n");
      if (args[0] === "worktree" && args[1] === "list") return Promise.resolve(output);
      if (args[0] === "worktree" && args[1] === "add") return Promise.resolve("");
      throw new Error(`Unexpected Git command: ${args.join(" ")}`);
    });
    const status = {
      baseBranches: ["main"],
      branch: "linked",
      branches: ["main", "linked"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    const created = await createProjectWorktree(
      linkedRoot,
      { branch: "feat/next", expectedSnapshot: status.snapshot },
      executeGit,
      () => Promise.resolve(status),
    );

    expect(created.path).toBe(join(dirname(mainRoot), "feat-next"));
    expect(executeGit).toHaveBeenCalledWith(linkedRoot, ["worktree", "list", "--porcelain", "-z"]);
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
      await mkdtemp(join(tmpdir(), "codexly-git-worktree-target-test-")),
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
