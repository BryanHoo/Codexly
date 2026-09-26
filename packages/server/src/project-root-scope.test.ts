import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ProjectRepository } from "@codexly/core";
import type { Project } from "@codexly/protocol";

import { resolveProjectRoot, resolveProjectRootEntry } from "./project-root-scope.js";

const project: Project = {
  createdAt: "2026-08-22T00:00:00.000Z",
  id: "aggregate",
  name: "Aggregate",
  roots: [
    { id: "root-primary", path: "/workspace/primary" },
    { id: "root-secondary", path: "/workspace/secondary" },
  ],
};

function createRepository(value: Project | undefined): ProjectRepository {
  return {
    list: vi.fn(() => Promise.resolve(value === undefined ? [] : [value])),
    read: vi.fn(() => Promise.resolve(value)),
    register: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    reorder: vi.fn(),
  };
}

describe("resolveProjectRoot", () => {
  it("accepts only a linked worktree of the same Project repository", async ({
    onTestFinished,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "codexly-task-root-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const rootPath = join(directory, "source");
    const worktreePath = join(directory, "feature");
    const runGit = async (...args: string[]) => {
      await promisify(execFile)("git", ["-C", rootPath, ...args]);
    };
    await promisify(execFile)("git", ["init", rootPath]);
    await runGit("config", "user.name", "Codexly Test");
    await runGit("config", "user.email", "test@example.com");
    await writeFile(join(rootPath, "README.md"), "test\n");
    await runGit("add", "README.md");
    await runGit("commit", "-m", "initial");
    await runGit("worktree", "add", "-b", "feature", worktreePath, "HEAD");
    const repository = createRepository({ ...project, roots: [{ id: "source", path: rootPath }] });

    await expect(resolveProjectRoot(repository, project.id, worktreePath)).resolves.toBe(
      await realpath(worktreePath),
    );
    await expect(resolveProjectRoot(repository, project.id, directory)).rejects.toHaveProperty(
      "code",
      "PROJECT_ROOT_INVALID",
    );
  });

  it("resolves a selected member and defaults internal callers to the primary root", async () => {
    const repository = createRepository(project);

    await expect(resolveProjectRoot(repository, project.id, "/workspace/secondary")).resolves.toBe(
      "/workspace/secondary",
    );
    await expect(resolveProjectRoot(repository, project.id)).resolves.toBe("/workspace/primary");
    await expect(
      resolveProjectRootEntry(repository, project.id, "/workspace/secondary"),
    ).resolves.toEqual(project.roots[1]);
  });

  it("rejects unknown projects and roots without probing the filesystem", async () => {
    await expect(resolveProjectRoot(createRepository(undefined), project.id)).rejects.toMatchObject(
      {
        code: "PROJECT_NOT_FOUND",
      },
    );
    await expect(
      resolveProjectRoot(createRepository(project), project.id, "/workspace/outside"),
    ).rejects.toHaveProperty("code", "PROJECT_ROOT_INVALID");
  });
});
