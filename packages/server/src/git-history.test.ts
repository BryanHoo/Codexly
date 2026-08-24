import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitCommandExecutor } from "./git-command.js";
import { GitHistoryError, readProjectGitHistory } from "./git-history.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "code-agent-git-history-"));
  temporaryDirectories.push(directory);
  return directory;
}

function serializeCommits(count: number, start = 0): string {
  return Array.from({ length: count }, (_, index) => {
    const sequence = start + index;
    const sha = sequence.toString(16).padStart(40, "0");
    return [
      sha,
      `Developer ${String(sequence)}`,
      `developer${String(sequence)}@example.com`,
      "2026-08-06T08:30:00+08:00",
      `Commit ${String(sequence)}`,
      "",
    ].join("\0");
  }).join("\n");
}

describe("readProjectGitHistory", () => {
  it("reads root history in fixed pages of twenty commits", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, ".git"));
    const executeGit = vi.fn<GitCommandExecutor>((_root, arguments_) =>
      Promise.resolve(arguments_[0] === "branch" ? "feat/root-history\n" : serializeCommits(21)),
    );

    const firstPage = await readProjectGitHistory(projectRoot, {}, executeGit);
    const secondPage = await readProjectGitHistory(projectRoot, { cursor: "20" }, executeGit);
    const resolvedProjectRoot = await realpath(projectRoot);

    expect(firstPage).toMatchObject({
      branch: "feat/root-history",
      nextCursor: "20",
      repositories: [],
      repository: null,
      repositoryMode: "root",
    });
    expect(firstPage.commits).toHaveLength(20);
    expect(firstPage.commits[0]).toMatchObject({ sha: "0".repeat(40), title: "Commit 0" });
    expect(secondPage.commits).toHaveLength(20);
    expect(executeGit).toHaveBeenCalledWith(resolvedProjectRoot, ["branch", "--show-current"]);
    expect(executeGit).toHaveBeenNthCalledWith(
      2,
      resolvedProjectRoot,
      expect.arrayContaining(["--max-count=21", "--skip=0"]),
    );
    expect(executeGit).toHaveBeenNthCalledWith(
      4,
      resolvedProjectRoot,
      expect.arrayContaining(["--max-count=21", "--skip=20"]),
    );
    const firstPageArguments = executeGit.mock.calls[1]?.[1];
    expect(firstPageArguments?.at(-1)).toBe("HEAD");
    expect(firstPageArguments).not.toContain("--all");
  });

  it("lists direct child repositories and reads only the selected tab", async () => {
    const projectRoot = await createTemporaryProject();
    const appsRoot = join(projectRoot, "apps");
    const packagesRoot = join(projectRoot, "packages");
    await Promise.all([
      mkdir(join(appsRoot, ".git"), { recursive: true }),
      mkdir(join(packagesRoot, ".git"), { recursive: true }),
      mkdir(join(projectRoot, "docs")),
    ]);
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) =>
      Promise.resolve(arguments_[0] === "branch" ? "release/packages\n" : serializeCommits(1)),
    );

    const page = await readProjectGitHistory(projectRoot, { repository: "packages" }, executeGit);

    expect(page).toMatchObject({
      branch: "release/packages",
      nextCursor: null,
      repositories: ["apps", "packages"],
      repository: "packages",
      repositoryMode: "children",
    });
    expect(executeGit).toHaveBeenCalledTimes(2);
    expect(executeGit).toHaveBeenCalledWith(await realpath(packagesRoot), [
      "branch",
      "--show-current",
    ]);
  });

  it("rejects relative roots and unknown child repositories", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, "apps", ".git"), { recursive: true });
    const executeGit = vi.fn(() => Promise.resolve(""));

    await expect(readProjectGitHistory("relative", {}, executeGit)).rejects.toThrow(
      "Project root must be absolute",
    );
    const unknownRepository = readProjectGitHistory(
      projectRoot,
      { repository: "packages" },
      executeGit,
    );
    await expect(unknownRepository).rejects.toBeInstanceOf(GitHistoryError);
    await expect(unknownRepository).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
    expect(executeGit).not.toHaveBeenCalled();
  });
});
