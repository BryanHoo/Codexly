import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitCommandExecutor } from "./git-command.js";
import { readProjectGitCommitFileDiff, readProjectGitCommitFiles } from "./git-commit-review.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codexly-git-commit-review-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, ".git"));
  return directory;
}

describe("Git commit review", () => {
  it("rejects an aggregate project root until a direct repository is selected", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-git-commit-review-"));
    temporaryDirectories.push(projectRoot);
    await mkdir(join(projectRoot, "apps", ".git"), { recursive: true });
    const executeGit = vi.fn<GitCommandExecutor>(() => Promise.resolve(""));

    await expect(
      readProjectGitCommitFiles(projectRoot, { sha: "a".repeat(40) }, executeGit),
    ).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
    expect(executeGit).not.toHaveBeenCalled();
  });

  it("pages commit files in groups of one hundred", async () => {
    const projectRoot = await createRepository();
    const output = Array.from({ length: 101 }, (_, index) =>
      [index === 0 ? "A" : index === 100 ? "D" : "M", `src/file-${String(index)}.ts`, ""].join(
        "\0",
      ),
    ).join("");
    const executeGit = vi.fn<GitCommandExecutor>(() => Promise.resolve(output));

    const page = await readProjectGitCommitFiles(projectRoot, { sha: "a".repeat(40) }, executeGit);

    expect(page.files).toHaveLength(100);
    expect(page.files[0]).toEqual({ kind: "create", path: "src/file-0.ts" });
    expect(page.nextCursor).toBe("100");
    expect(executeGit.mock.calls[0]?.[1]).toEqual([
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-status",
      "-z",
      "-r",
      "--no-renames",
      "a".repeat(40),
      "--",
    ]);
  });

  it("returns a byte-bounded single-file diff", async () => {
    const projectRoot = await createRepository();
    const executeGit = vi.fn<GitCommandExecutor>(() => Promise.resolve("界".repeat(300_000)));

    const result = await readProjectGitCommitFileDiff(
      projectRoot,
      { path: "src/index.ts", sha: "b".repeat(40) },
      executeGit,
    );

    expect(Buffer.byteLength(result.diff)).toBeLessThanOrEqual(512 * 1024);
    expect(result.truncated).toBe(true);
    expect(executeGit.mock.calls[0]?.[1].at(-2)).toBe("--");
    expect(executeGit.mock.calls[0]?.[1].at(-1)).toBe("src/index.ts");
  });
});
