import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GitCommandOutputLimitError } from "./git-command.js";
import {
  invalidateProjectGitBranchCache,
  readGitWorkingTreeStatus,
  readProjectGitStatus,
} from "./git-working-tree.js";

function createGitDiffOutput(paths: readonly string[], replacement: string): string {
  const rawChanges = paths.map((path) => `:100644 100644 1111111 2222222 M\0${path}\0`).join("");
  const patches = paths
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-original\n+${replacement}\n`,
    )
    .join("");
  return `${rawChanges}\0${patches}`;
}

describe("readGitWorkingTreeStatus", () => {
  it("reads the repository through the real parameterized Git command", async () => {
    const status = await readGitWorkingTreeStatus(process.cwd());

    // 标签检出会处于 detached HEAD，此时 Git 不提供当前分支名。
    expect(status.branch === null || typeof status.branch === "string").toBe(true);
    // actions/checkout 的标签检出可能不包含任何远端分支引用。
    expect(Array.isArray(status.baseBranches)).toBe(true);
    expect(Array.isArray(status.branches)).toBe(true);
    expect(status.repositoryMode).toBe("root");
    expect(status.snapshot).toMatch(/^[a-f0-9]{64}$/u);
    expect(Array.isArray(status.staged)).toBe(true);
    expect(Array.isArray(status.unstaged)).toBe(true);
  });

  it("prioritizes the remote default branch in the selectable base branches", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, ".git"));
      let refReads = 0;
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          return Promise.resolve("");
        }
        if (arguments_[0] === "branch") {
          return Promise.resolve("feat/review\n");
        }
        if (arguments_[0] === "for-each-ref" && !arguments_.includes("refs/remotes")) {
          refReads += 1;
          return Promise.resolve("feat/review\nmain\nrelease\n");
        }
        if (arguments_[0] === "for-each-ref") {
          refReads += 1;
          return Promise.resolve(
            "main\nfeat/review\norigin/HEAD\norigin/main\norigin/release\nrelease\n",
          );
        }
        if (arguments_[0] === "symbolic-ref") {
          return Promise.resolve("refs/remotes/origin/main\n");
        }
        throw new Error(`Unexpected Git command: ${arguments_.join(" ")}`);
      };

      await expect(readGitWorkingTreeStatus(projectRoot, executeGit)).resolves.toMatchObject({
        baseBranches: ["origin/main", "main", "origin/release", "release"],
        branch: "feat/review",
        branches: ["feat/review", "main", "release"],
      });
      await readGitWorkingTreeStatus(projectRoot, executeGit);
      expect(refReads).toBe(2);

      invalidateProjectGitBranchCache(projectRoot);
      await readGitWorkingTreeStatus(projectRoot, executeGit);
      expect(refReads).toBe(4);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("returns tracked metadata without reading diffs unless details are requested", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, ".git"));
      await writeFile(join(projectRoot, "tracked.txt"), "changed\n");
      const diffCommands: string[][] = [];
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") return Promise.resolve(" M tracked.txt\0");
        if (arguments_[0] === "branch") return Promise.resolve("main\n");
        if (arguments_[0] === "for-each-ref" || arguments_[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        diffCommands.push([...arguments_]);
        return Promise.resolve(createGitDiffOutput(["tracked.txt"], "changed"));
      };

      const summary = await readProjectGitStatus(projectRoot, {}, executeGit);
      expect(summary.unstaged).toEqual([{ diff: "", kind: "update", path: "tracked.txt" }]);
      expect(diffCommands).toHaveLength(0);

      const detailed = await readProjectGitStatus(projectRoot, { includeDiff: true }, executeGit);
      expect(detailed.unstaged[0]?.diff).toContain("+changed");
      expect(detailed.snapshot).toBe(summary.snapshot);
      expect(diffCommands).toHaveLength(1);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("separates staged, unstaged, untracked, and partially staged changes", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, ".git"));
      await writeFile(join(projectRoot, "untracked.txt"), "new file\n");
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          return Promise.resolve("MM partial.txt\0M  staged.txt\0?? untracked.txt\0");
        }
        if (arguments_[0] === "branch") {
          return Promise.resolve("feat/review\n");
        }
        if (arguments_[0] === "for-each-ref") {
          return Promise.resolve("main\norigin/main\n");
        }
        if (arguments_[0] === "symbolic-ref") {
          return Promise.resolve("refs/remotes/origin/main\n");
        }
        const location = arguments_.includes("--cached") ? "staged" : "unstaged";
        const paths = location === "staged" ? ["partial.txt", "staged.txt"] : ["partial.txt"];
        return Promise.resolve(createGitDiffOutput(paths, `${location} version`));
      };

      const status = await readGitWorkingTreeStatus(projectRoot, executeGit, {
        includeDiff: true,
      });

      expect(status.staged.map((change) => change.path)).toEqual(["partial.txt", "staged.txt"]);
      expect(status.unstaged.map((change) => change.path)).toEqual([
        "partial.txt",
        "untracked.txt",
      ]);
      expect(status.unstaged.find((change) => change.path === "untracked.txt")).toMatchObject({
        kind: "create",
      });
      expect(status.staged[0]?.diff).toContain("+staged version");
      expect(status.unstaged[0]?.diff).toContain("+unstaged version");
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("reads all tracked changes with one staged and one unstaged diff command", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, ".git"));
      const diffCommands: string[][] = [];
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          return Promise.resolve("MM partial.txt\0M  staged.txt\0 M first.txt\0 M second.txt\0");
        }
        if (arguments_[0] !== "diff") {
          return Promise.resolve("");
        }

        diffCommands.push([...arguments_]);
        const location = arguments_.includes("--cached") ? "staged" : "unstaged";
        const requestedPaths = arguments_
          .filter((argument) => argument.startsWith(":(literal)"))
          .map((argument) => argument.replace(":(literal)", ""));
        if (requestedPaths.length > 0) {
          return Promise.resolve(createGitDiffOutput(requestedPaths, location));
        }

        const paths =
          location === "staged"
            ? ["partial.txt", "staged.txt"]
            : ["first.txt", "partial.txt", "second.txt"];
        return Promise.resolve(createGitDiffOutput(paths, location));
      };

      const status = await readGitWorkingTreeStatus(projectRoot, executeGit, {
        includeDiff: true,
      });

      expect(diffCommands).toHaveLength(2);
      expect(diffCommands.filter((arguments_) => arguments_.includes("--cached"))).toHaveLength(1);
      expect(status.staged.map((change) => change.diff)).toEqual([
        expect.stringContaining("+staged"),
        expect.stringContaining("+staged"),
      ]);
      expect(status.unstaged.map((change) => change.diff)).toEqual([
        expect.stringContaining("+unstaged"),
        expect.stringContaining("+unstaged"),
        expect.stringContaining("+unstaged"),
      ]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("splits oversized tracked diffs and omits only a still-oversized file", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, ".git"));
      const diffCommands: string[][] = [];
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          return Promise.resolve(" M readable.txt\0 M oversized.txt\0");
        }
        if (arguments_[0] !== "diff") {
          return Promise.resolve("");
        }

        diffCommands.push([...arguments_]);
        const requestedPaths = arguments_
          .filter((argument) => argument.startsWith(":(literal)"))
          .map((argument) => argument.replace(":(literal)", ""));
        if (requestedPaths.length !== 1 || requestedPaths[0] === "oversized.txt") {
          return Promise.reject(new GitCommandOutputLimitError());
        }
        return Promise.resolve(createGitDiffOutput(requestedPaths, "readable"));
      };

      const status = await readGitWorkingTreeStatus(projectRoot, executeGit, {
        includeDiff: true,
      });

      expect(status.unstaged.find((change) => change.path === "readable.txt")?.diff).toContain(
        "+readable",
      );
      expect(status.unstaged.find((change) => change.path === "oversized.txt")?.diff).toBe("");
      expect(
        diffCommands.map((arguments_) =>
          arguments_.filter((argument) => argument.startsWith(":(literal)")),
        ),
      ).toEqual([
        [":(literal)readable.txt", ":(literal)oversized.txt"],
        [":(literal)readable.txt"],
        [":(literal)oversized.txt"],
      ]);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("reads and combines immediate child repositories when the project root is not Git", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    const frontendRoot = join(projectRoot, "frontend");
    const backendRoot = join(projectRoot, "backend");
    const nestedRepositoryRoot = join(projectRoot, "workspace", "nested");
    try {
      await Promise.all([
        mkdir(join(frontendRoot, ".git"), { recursive: true }),
        mkdir(join(backendRoot, ".git"), { recursive: true }),
        mkdir(join(nestedRepositoryRoot, ".git"), { recursive: true }),
        mkdir(join(projectRoot, "notes"), { recursive: true }),
      ]);
      const visitedStatusRoots: string[] = [];
      const executeGit = (root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          visitedStatusRoots.push(root);
          if (root === projectRoot) {
            return Promise.reject(new Error("not a git repository"));
          }
          if (root === frontendRoot) {
            return Promise.resolve(" M src/app.ts\0");
          }
          if (root === backendRoot) {
            return Promise.resolve("M  src/server.ts\0");
          }
        }

        const path = root === frontendRoot ? "src/app.ts" : "src/server.ts";
        return Promise.resolve(createGitDiffOutput([path], "new"));
      };

      const status = await readGitWorkingTreeStatus(projectRoot, executeGit);

      expect(status.staged.map((change) => change.path)).toEqual(["backend/src/server.ts"]);
      expect(status.unstaged.map((change) => change.path)).toEqual(["frontend/src/app.ts"]);
      expect(status.repositoryMode).toBe("children");
      expect(status.branches).toEqual([]);
      expect(status.snapshot).toMatch(/^[a-f0-9]{64}$/u);
      expect(visitedStatusRoots.toSorted()).toEqual([backendRoot, frontendRoot].toSorted());
      expect(visitedStatusRoots).not.toContain(projectRoot);
      expect(visitedStatusRoots).not.toContain(nestedRepositoryRoot);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("returns an empty non-Git status when the project has no repositories", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, "notes"));

      const first = await readGitWorkingTreeStatus(projectRoot);
      const second = await readGitWorkingTreeStatus(projectRoot);

      expect(first).toEqual({
        baseBranches: [],
        branch: null,
        branches: [],
        repositoryMode: "none",
        snapshot: second.snapshot,
        staged: [],
        unstaged: [],
      });
      expect(first.snapshot).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("reads one selected immediate child repository with repository-relative paths", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    const frontendRoot = join(projectRoot, "frontend");
    try {
      await mkdir(join(frontendRoot, ".git"), { recursive: true });
      let refReads = 0;
      const visitedRoots: string[] = [];
      const executeGit = (root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          visitedRoots.push(root);
          return Promise.resolve(" M src/app.ts\0");
        }
        if (arguments_[0] === "branch") {
          return Promise.resolve("feat/frontend\n");
        }
        if (arguments_[0] === "for-each-ref") {
          refReads += 1;
          return Promise.resolve("");
        }
        if (arguments_[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        return Promise.resolve(createGitDiffOutput(["src/app.ts"], "new"));
      };

      const status = await readProjectGitStatus(
        projectRoot,
        { repository: "frontend" },
        executeGit,
      );

      expect(status).toMatchObject({ branch: "feat/frontend", repositoryMode: "root" });
      expect(status.unstaged.map((change) => change.path)).toEqual(["src/app.ts"]);
      expect(visitedRoots).toEqual([frontendRoot]);
      await readProjectGitStatus(projectRoot, { repository: "frontend" }, executeGit);
      expect(refReads).toBe(2);
      invalidateProjectGitBranchCache(projectRoot);
      await readProjectGitStatus(projectRoot, { repository: "frontend" }, executeGit);
      expect(refReads).toBe(4);
      await expect(
        readProjectGitStatus(projectRoot, { repository: "workspace/nested" }, executeGit),
      ).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("changes the snapshot when selected file content changes", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-status-test-")));
    try {
      await mkdir(join(projectRoot, ".git"));
      await writeFile(join(projectRoot, "tracked.txt"), "first\n");
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          return Promise.resolve(" M tracked.txt\0");
        }
        if (arguments_[0] === "branch") {
          return Promise.resolve("main\n");
        }
        if (arguments_[0] === "for-each-ref" || arguments_[0] === "symbolic-ref") {
          return Promise.resolve("");
        }
        return Promise.resolve(createGitDiffOutput(["tracked.txt"], awaitText));
      };
      let awaitText = "second";
      const first = await readGitWorkingTreeStatus(projectRoot, executeGit);
      awaitText = "third";
      await writeFile(join(projectRoot, "tracked.txt"), "third\n");
      const second = await readGitWorkingTreeStatus(projectRoot, executeGit);

      expect(first.snapshot).not.toBe(second.snapshot);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("rejects relative project roots before invoking Git", async () => {
    await expect(readGitWorkingTreeStatus("relative/project")).rejects.toThrow(
      "Project root must be absolute",
    );
  });
});
