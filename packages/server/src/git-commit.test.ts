import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { commitSelectedProjectChanges } from "./git-commit.js";
import type { GitCommitError } from "./git-commit.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const executeFile = promisify(execFile);
const temporaryRoots: string[] = [];

async function runGit(root: string, ...arguments_: string[]) {
  return executeFile("git", ["-C", root, ...arguments_], { encoding: "utf8" });
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "codexly-git-commit-test-"));
  temporaryRoots.push(root);
  await runGit(root, "init", "--initial-branch=main");
  await runGit(root, "config", "user.name", "Codexly Test");
  await runGit(root, "config", "user.email", "codexly@example.com");
  await Promise.all([
    writeFile(join(root, "selected.txt"), "selected old\n"),
    writeFile(join(root, "unselected.txt"), "unselected old\n"),
  ]);
  await runGit(root, "add", "--all");
  await runGit(root, "commit", "-m", "chore(test): 初始化仓库");
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("commitSelectedProjectChanges", () => {
  it("keeps unborn repository snapshots stable across summary and detailed reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-git-unborn-test-"));
    temporaryRoots.push(root);
    await runGit(root, "init", "--initial-branch=main");
    await writeFile(join(root, "new.txt"), "new\n");
    await runGit(root, "add", "new.txt");
    const summary = await readGitWorkingTreeStatus(root);
    const detailed = await readGitWorkingTreeStatus(root, undefined, { includeDiff: true });
    expect(detailed.snapshot).toBe(summary.snapshot);
    expect(detailed.staged[0]?.diff).toContain("+new");
  });

  it("invalidates aggregate snapshots when a child index changes", async () => {
    const repositoryRoot = await createRepository();
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-git-aggregate-test-"));
    temporaryRoots.push(projectRoot);
    const root = join(projectRoot, "child");
    await rename(repositoryRoot, root);
    await writeFile(join(root, "selected.txt"), "staged\n");
    await runGit(root, "add", "selected.txt");
    await writeFile(join(root, "selected.txt"), "working\n");
    const before = await readGitWorkingTreeStatus(projectRoot);
    const object = (await runGit(root, "rev-parse", "HEAD:unselected.txt")).stdout.trim();
    await runGit(root, "update-index", "--cacheinfo", `100644,${object},selected.txt`);
    const after = await readGitWorkingTreeStatus(projectRoot);
    expect(after.staged).toEqual(before.staged);
    expect(after.unstaged).toEqual(before.unstaged);
    expect(after.snapshot).not.toBe(before.snapshot);
  });

  it.each(["object", "mode", "HEAD"])(
    "rejects an old snapshot when only %s changes",
    async (change) => {
      const root = await createRepository();
      await writeFile(join(root, "selected.txt"), "staged version\n");
      await runGit(root, "add", "selected.txt");
      await writeFile(join(root, "selected.txt"), "working version\n");
      const before = await readGitWorkingTreeStatus(root);
      const previousHead = (await runGit(root, "rev-parse", "HEAD")).stdout;
      const previousStatus = (await runGit(root, "status", "--porcelain=v1")).stdout;
      // 只改索引或提交引用，不触碰工作区文件及其元数据。
      if (change === "object") {
        const object = (await runGit(root, "rev-parse", "HEAD:unselected.txt")).stdout.trim();
        await runGit(root, "update-index", "--cacheinfo", `100644,${object},selected.txt`);
      } else if (change === "mode") {
        await runGit(root, "update-index", "--chmod=+x", "selected.txt");
      } else {
        await runGit(root, "commit", "--amend", "--only", "-m", "chore(test): 更新提交说明");
      }
      const currentHead = (await runGit(root, "rev-parse", "HEAD")).stdout;
      expect((await runGit(root, "status", "--porcelain=v1")).stdout).toBe(previousStatus);
      await expect(
        commitSelectedProjectChanges(root, {
          action: "commit",
          expectedSnapshot: before.snapshot,
          message: "fix(git): 校验快照",
          paths: ["selected.txt"],
        }),
      ).rejects.toMatchObject({ code: "GIT_STATUS_CHANGED" });
      expect((await runGit(root, "rev-parse", "HEAD")).stdout).toBe(currentHead);
      if (change !== "HEAD") expect(currentHead).toBe(previousHead);
    },
  );

  it("commits only selected tracked and untracked files while preserving other staged files", async () => {
    const root = await createRepository();
    await Promise.all([
      writeFile(join(root, "selected.txt"), "selected current\n"),
      writeFile(join(root, "unselected.txt"), "unselected staged\n"),
      writeFile(join(root, "new.txt"), "new selected\n"),
    ]);
    await runGit(root, "add", "--", "unselected.txt");
    const status = await readGitWorkingTreeStatus(root);

    const result = await commitSelectedProjectChanges(root, {
      action: "commit",
      expectedSnapshot: status.snapshot,
      message: "feat(git): 提交选择文件",
      paths: ["selected.txt", "new.txt"],
    });

    const committedFiles = await runGit(root, "show", "--format=", "--name-only", "HEAD");
    const stagedFiles = await runGit(root, "diff", "--cached", "--name-only");
    expect(committedFiles.stdout.trim().split("\n").toSorted()).toEqual([
      "new.txt",
      "selected.txt",
    ]);
    expect(stagedFiles.stdout.trim()).toBe("unselected.txt");
    expect(result).toMatchObject({
      branch: "main",
      message: "feat(git): 提交选择文件",
      pushError: null,
      pushStatus: "not_requested",
    });
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/u);
  });

  it("commits the staged version of a mixed file while preserving its unstaged changes", async () => {
    const root = await createRepository();
    await writeFile(join(root, "selected.txt"), "selected staged\n");
    await runGit(root, "add", "--", "selected.txt");
    await writeFile(join(root, "selected.txt"), "selected old\n");
    const status = await readGitWorkingTreeStatus(root);

    await commitSelectedProjectChanges(root, {
      action: "commit",
      expectedSnapshot: status.snapshot,
      message: "fix(git): 提交暂存版本",
      paths: ["selected.txt"],
    });

    await expect(runGit(root, "show", "HEAD:selected.txt")).resolves.toMatchObject({
      stdout: "selected staged\n",
    });
    const unstagedDiff = await runGit(root, "diff", "--", "selected.txt");
    expect(unstagedDiff.stdout).toContain("+selected old");
    await expect(runGit(root, "diff", "--cached", "--name-only")).resolves.toMatchObject({
      stdout: "",
    });
  });

  it("ignores inherited Git configuration that could alter commit execution", async () => {
    const root = await createRepository();
    await writeFile(join(root, "selected.txt"), "changed\n");
    const status = await readGitWorkingTreeStatus(root);

    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "Injected Name");
    await commitSelectedProjectChanges(root, {
      action: "commit",
      expectedSnapshot: status.snapshot,
      message: "fix(git): 隔离提交环境",
      paths: ["selected.txt"],
    });
    vi.unstubAllEnvs();

    await expect(runGit(root, "log", "-1", "--pretty=%an")).resolves.toMatchObject({
      stdout: "Codexly Test\n",
    });
  });

  it("rejects stale snapshots and paths outside the current changes", async () => {
    const root = await createRepository();
    await writeFile(join(root, "selected.txt"), "changed\n");
    const status = await readGitWorkingTreeStatus(root);

    await expect(
      commitSelectedProjectChanges(root, {
        action: "commit",
        expectedSnapshot: "0".repeat(64),
        message: "fix(git): 修复提交",
        paths: ["selected.txt"],
      }),
    ).rejects.toMatchObject({ code: "GIT_STATUS_CHANGED" } satisfies Partial<GitCommitError>);
    await expect(
      commitSelectedProjectChanges(root, {
        action: "commit",
        expectedSnapshot: status.snapshot,
        message: "fix(git): 修复提交",
        paths: ["missing.txt"],
      }),
    ).rejects.toMatchObject({ code: "GIT_PATH_UNAVAILABLE" } satisfies Partial<GitCommitError>);
  });

  it("keeps a successful commit when push has no configured upstream", async () => {
    const root = await createRepository();
    await writeFile(join(root, "selected.txt"), "changed\n");
    const status = await readGitWorkingTreeStatus(root);

    const result = await commitSelectedProjectChanges(root, {
      action: "commit_and_push",
      expectedSnapshot: status.snapshot,
      message: "fix(git): 修复提交",
      paths: ["selected.txt"],
    });
    expect(result.pushError).toContain("upstream");
    expect(result.pushStatus).toBe("not_configured");
    await expect(runGit(root, "log", "-1", "--pretty=%s")).resolves.toMatchObject({
      stdout: "fix(git): 修复提交\n",
    });
  });

  it("commits only inside the selected immediate child repository", async () => {
    const repositoryRoot = await createRepository();
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-git-project-test-"));
    temporaryRoots.push(projectRoot);
    const selectedRepositoryRoot = join(projectRoot, "frontend");
    await rename(repositoryRoot, selectedRepositoryRoot);
    await writeFile(join(selectedRepositoryRoot, "selected.txt"), "selected current\n");
    const status = await readGitWorkingTreeStatus(selectedRepositoryRoot);

    await expect(
      commitSelectedProjectChanges(projectRoot, {
        action: "commit",
        expectedSnapshot: status.snapshot,
        message: "feat(git): 提交子仓库变更",
        paths: ["selected.txt"],
        repository: "frontend",
      }),
    ).resolves.toMatchObject({ branch: "main", pushStatus: "not_requested" });
    await expect(runGit(selectedRepositoryRoot, "log", "-1", "--pretty=%s")).resolves.toMatchObject(
      {
        stdout: "feat(git): 提交子仓库变更\n",
      },
    );
  });
});
