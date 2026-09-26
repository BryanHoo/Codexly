import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Project } from "@codexly/protocol";

import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  projectRootPath,
} from "./app-all.test-support.js";

describe("worktree task routes", () => {
  it("uses the linked worktree for files, Git, and opening a terminal", async ({
    onTestFinished,
  }) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "codexly-app-worktree-")));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "source");
    const worktreePath = join(directory, "feature");
    const git = async (...args: string[]) => {
      await promisify(execFile)("git", ["-C", source, ...args]);
    };
    await promisify(execFile)("git", ["init", source]);
    await git("config", "user.name", "Codexly Test");
    await git("config", "user.email", "test@example.com");
    await writeFile(join(source, "README.md"), "source\n");
    await git("add", "README.md");
    await git("commit", "-m", "initial");
    await git("worktree", "add", "-b", "feature", worktreePath, "HEAD");
    const readFileTree = vi.fn(() => Promise.resolve({ entries: [], path: null }));
    const status = {
      baseBranches: ["main"],
      branch: "feature",
      branches: ["feature"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const readProjectGitStatus = vi.fn(() => Promise.resolve(status));
    const open = vi.fn(() => Promise.resolve());
    const options = createServerOptions(createProvider().provider, {
      projectOpenService: {
        getCapabilities: () => Promise.resolve({ apps: [], platform: "darwin" as const }),
        open,
      },
      readProjectFileTree: readFileTree,
      readProjectGitStatus,
    });
    const linkedProject: Project = { ...project, roots: [{ id: "source", path: source }] };
    const originalRepository = options.projectRepository;
    const appOptions = {
      ...options,
      projectRepository: {
        ...originalRepository,
        read: vi.fn((projectId: string) =>
          Promise.resolve(projectId === project.id ? linkedProject : undefined),
        ),
      },
    };
    const app = await createCodexlyServer(appOptions);
    closeCallbacks.push(() => app.close());
    const query = `rootPath=${encodeURIComponent(worktreePath)}`;

    const [files, gitStatus, terminal] = await Promise.all([
      app.inject({ method: "GET", url: `/v1/projects/codexly/files/tree?${query}` }),
      app.inject({ method: "GET", url: `/v1/projects/codexly/git/status?${query}` }),
      app.inject({
        headers: { "idempotency-key": "open-worktree-terminal" },
        method: "POST",
        payload: { appId: "terminal" },
        url: `/v1/projects/codexly/open?${query}`,
      }),
    ]);

    expect([files.statusCode, gitStatus.statusCode, terminal.statusCode]).toEqual([200, 200, 200]);
    expect(readFileTree).toHaveBeenCalledWith(worktreePath, undefined);
    expect(readProjectGitStatus).toHaveBeenCalledWith(worktreePath, {});
    expect(open).toHaveBeenCalledWith(worktreePath, "terminal", undefined);
  });

  it("creates a worktree without registering a Project and starts its task in the original Project", async () => {
    const provider = createProvider();
    const worktreePath = "/workspace/Codexly-feature";
    const worktree = { branch: "feature", current: false, path: worktreePath };
    const status = {
      baseBranches: ["main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const createProjectWorktree = vi.fn(() => Promise.resolve(worktree));
    const resolveProjectWorktree = vi.fn(() => Promise.resolve(worktree));
    const options = createServerOptions(provider.provider, {
      createProjectWorktree,
      readProjectGitStatus: vi.fn(() => Promise.resolve(status)),
      readProjectWorktrees: vi.fn(() => Promise.resolve({ worktrees: [worktree] })),
      resolveProjectWorktree,
    });
    const app = await createCodexlyServer(options);
    closeCallbacks.push(() => app.close());
    const rootQuery = `rootPath=${encodeURIComponent(projectRootPath)}`;

    const created = await app.inject({
      headers: { "idempotency-key": "create-task-worktree" },
      method: "POST",
      payload: { branch: "feature", expectedSnapshot: status.snapshot },
      url: `/v1/projects/codexly/git/task-worktrees?${rootQuery}`,
    });
    const task = await app.inject({
      headers: { "idempotency-key": "start-worktree-task" },
      method: "POST",
      payload: { rootPath: projectRootPath, worktreePath },
      url: "/v1/projects/codexly/tasks",
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ worktree });
    expect(options.projectRepository.register).not.toHaveBeenCalled();
    expect(task.statusCode).toBe(201);
    expect(provider.startTask).toHaveBeenCalledWith({ workspacePath: worktreePath });
    expect(resolveProjectWorktree).toHaveBeenCalledWith(projectRootPath, worktreePath);
  });

  it("rejects a worktree path without its source Project root", async () => {
    const provider = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider.provider));
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      headers: { "idempotency-key": "invalid-worktree-task" },
      method: "POST",
      payload: { worktreePath: "/outside" },
      url: "/v1/projects/codexly/tasks",
    });
    expect(response.statusCode).toBe(400);
    expect(provider.startTask).not.toHaveBeenCalled();
  });
});
