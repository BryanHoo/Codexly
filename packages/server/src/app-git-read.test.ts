import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { GitBranchError } from "./git-branch.js";
import { GitWorktreeError } from "./git-worktree.js";
import {
  projectRootPath,
  encodedProjectRootPath,
  closeCallbacks,
  createProvider,
  createServerOptions,
} from "./app-all.test-support.js";

describe("server Git read routes", () => {
  it("serves the configured project's Git working tree status", async () => {
    const { provider } = createProvider();
    const readProjectGitStatus = vi.fn(() =>
      Promise.resolve({
        baseBranches: ["origin/main", "main"],
        branch: "feat/review",
        branches: ["feat/review", "main"],
        repositoryMode: "root" as const,
        snapshot: "c".repeat(64),
        staged: [
          {
            diff: "--- a/staged.ts\n+++ b/staged.ts\n@@ -1 +1 @@\n-old\n+new",
            kind: "update" as const,
            path: "staged.ts",
          },
        ],
        unstaged: [],
      }),
    );
    const app = await createCodexlyServer(createServerOptions(provider, { readProjectGitStatus }));
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/status?repository=frontend&rootPath=${encodedProjectRootPath}`,
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/other/git/status?rootPath=${encodedProjectRootPath}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      baseBranches: ["origin/main", "main"],
      branch: "feat/review",
      staged: [{ path: "staged.ts" }],
      unstaged: [],
    });
    expect(readProjectGitStatus).toHaveBeenCalledWith(projectRootPath, {
      repository: "frontend",
    });
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectGitStatus).toHaveBeenCalledTimes(1);
  });

  it("serves paginated Git history for the selected repository tab", async () => {
    const { provider } = createProvider();
    const historyPage = {
      branch: "release/server",
      commits: [
        {
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: "a".repeat(40),
          title: "feat(git): 添加历史记录",
        },
      ],
      nextCursor: "40",
      repositories: ["apps/web", "packages/server"],
      repository: "packages/server",
      repositoryMode: "children" as const,
    };
    const readProjectGitHistory = vi.fn(() => Promise.resolve(historyPage));
    const app = await createCodexlyServer(createServerOptions(provider, { readProjectGitHistory }));
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/history?repository=packages%2Fserver&cursor=20&rootPath=${encodedProjectRootPath}`,
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/other/git/history?rootPath=${encodedProjectRootPath}`,
    });
    const invalidQueryResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/history?cursor=sha&rootPath=${encodedProjectRootPath}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(historyPage);
    expect(readProjectGitHistory).toHaveBeenCalledWith(projectRootPath, {
      cursor: "20",
      repository: "packages/server",
    });
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(invalidQueryResponse.statusCode).toBe(400);
    expect(readProjectGitHistory).toHaveBeenCalledTimes(1);
  });

  it("serves bounded commit files and a selected file diff", async () => {
    const { provider } = createProvider();
    const readProjectGitCommitFiles = vi.fn(() =>
      Promise.resolve({
        files: [{ kind: "update" as const, path: "src/index.ts" }],
        nextCursor: "100",
      }),
    );
    const readProjectGitCommitFileDiff = vi.fn(() =>
      Promise.resolve({ diff: "@@ -1 +1 @@\n-old\n+new\n", truncated: false }),
    );
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        readProjectGitCommitFileDiff,
        readProjectGitCommitFiles,
      }),
    );
    closeCallbacks.push(() => app.close());
    const sha = "a".repeat(40);

    const filesResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/commit-files?sha=${sha}&repository=packages%2Fserver&cursor=100&rootPath=${encodedProjectRootPath}`,
    });
    const diffResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/commit-diff?sha=${sha}&path=src%2Findex.ts&repository=packages%2Fserver&rootPath=${encodedProjectRootPath}`,
    });
    const invalidResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/commit-files?sha=HEAD&rootPath=${encodedProjectRootPath}`,
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/missing/git/commit-files?sha=${sha}&rootPath=${encodedProjectRootPath}`,
    });

    expect(filesResponse.statusCode).toBe(200);
    expect(filesResponse.json()).toEqual({
      files: [{ kind: "update", path: "src/index.ts" }],
      nextCursor: "100",
    });
    expect(diffResponse.statusCode).toBe(200);
    expect(diffResponse.json()).toMatchObject({ truncated: false });
    expect(invalidResponse.statusCode).toBe(400);
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectGitCommitFiles).toHaveBeenCalledWith(projectRootPath, {
      cursor: "100",
      repository: "packages/server",
      sha,
    });
    expect(readProjectGitCommitFileDiff).toHaveBeenCalledWith(projectRootPath, {
      path: "src/index.ts",
      repository: "packages/server",
      sha,
    });
  });

  it("switches a local project branch idempotently through the fixed Git mutation", async () => {
    const { provider } = createProvider();
    const expectedSnapshot = "c".repeat(64);
    const switchedStatus = {
      baseBranches: ["origin/main", "feat/review"],
      branch: "main",
      branches: ["main", "feat/review"],
      repositoryMode: "root" as const,
      snapshot: "d".repeat(64),
      staged: [],
      unstaged: [],
    };
    const switchProjectBranch = vi.fn(() => Promise.resolve(switchedStatus));
    const app = await createCodexlyServer(createServerOptions(provider, { switchProjectBranch }));
    closeCallbacks.push(() => app.close());
    const request = { branch: "main", expectedSnapshot };

    const first = await app.inject({
      headers: { "idempotency-key": "switch-main" },
      method: "POST",
      payload: request,
      url: `/v1/projects/codexly/git/branch?rootPath=${encodedProjectRootPath}`,
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "switch-main" },
      method: "POST",
      payload: request,
      url: `/v1/projects/codexly/git/branch?rootPath=${encodedProjectRootPath}`,
    });
    const invalid = await app.inject({
      headers: { "idempotency-key": "switch-invalid" },
      method: "POST",
      payload: { ...request, branch: "" },
      url: `/v1/projects/codexly/git/branch?rootPath=${encodedProjectRootPath}`,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual(switchedStatus);
    expect(repeated.json()).toEqual(switchedStatus);
    expect(invalid.statusCode).toBe(400);
    expect(switchProjectBranch).toHaveBeenCalledOnce();
    expect(switchProjectBranch).toHaveBeenCalledWith(projectRootPath, request);
  });

  it("maps branch-switch conflicts and command failures to bounded mutation errors", async () => {
    const { provider } = createProvider();
    const switchProjectBranch = vi
      .fn()
      .mockRejectedValueOnce(
        new GitBranchError("SNAPSHOT_MISMATCH", "Git working tree snapshot changed"),
      )
      .mockRejectedValueOnce(new GitBranchError("SWITCH_FAILED", "Git branch switch failed"));
    const app = await createCodexlyServer(createServerOptions(provider, { switchProjectBranch }));
    closeCallbacks.push(() => app.close());

    const stale = await app.inject({
      headers: { "idempotency-key": "switch-stale" },
      method: "POST",
      payload: { branch: "main", expectedSnapshot: "a".repeat(64) },
      url: `/v1/projects/codexly/git/branch?rootPath=${encodedProjectRootPath}`,
    });
    const failed = await app.inject({
      headers: { "idempotency-key": "switch-failed" },
      method: "POST",
      payload: { branch: "main", expectedSnapshot: "b".repeat(64) },
      url: `/v1/projects/codexly/git/branch?rootPath=${encodedProjectRootPath}`,
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "GIT_STATUS_CHANGED" });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      code: "GIT_BRANCH_SWITCH_FAILED",
      message: "Git branch switch failed",
      retryable: true,
    });
  });

  it("creates and switches to a local branch idempotently", async () => {
    const { provider } = createProvider();
    const expectedSnapshot = "a".repeat(64);
    const createdStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      repositoryMode: "root" as const,
      snapshot: "b".repeat(64),
      staged: [],
      unstaged: [],
    };
    const createProjectBranch = vi.fn(() => Promise.resolve(createdStatus));
    const app = await createCodexlyServer(createServerOptions(provider, { createProjectBranch }));
    closeCallbacks.push(() => app.close());
    const request = { branch: "feat/new-branch", expectedSnapshot };

    const first = await app.inject({
      headers: { "idempotency-key": "create-new-branch" },
      method: "POST",
      payload: request,
      url: `/v1/projects/codexly/git/branches?rootPath=${encodedProjectRootPath}`,
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "create-new-branch" },
      method: "POST",
      payload: request,
      url: `/v1/projects/codexly/git/branches?rootPath=${encodedProjectRootPath}`,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual(createdStatus);
    expect(repeated.json()).toEqual(createdStatus);
    expect(createProjectBranch).toHaveBeenCalledOnce();
    expect(createProjectBranch).toHaveBeenCalledWith(projectRootPath, request);
  });

  it("lists, creates, registers, and switches project worktrees idempotently", async () => {
    const { provider } = createProvider();
    const worktree = {
      branch: "feat/worktree",
      current: false,
      path: "/workspace/Codexly-feat-worktree",
    };
    const targetProject = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "codexly-feat-worktree",
      name: "Codexly-feat-worktree",
      roots: [{ id: "root-worktree", path: worktree.path }],
    };
    const readProjectWorktrees = vi.fn(() => Promise.resolve({ worktrees: [worktree] }));
    const createProjectWorktree = vi.fn(() => Promise.resolve(worktree));
    const resolveProjectWorktree = vi.fn(() => Promise.resolve(worktree));
    const options = createServerOptions(provider, {
      createProjectWorktree,
      readProjectWorktrees,
      resolveProjectWorktree,
    });
    const register = vi.fn(() => Promise.resolve(targetProject));
    const app = await createCodexlyServer({
      ...options,
      projectRepository: { ...options.projectRepository, register },
    });
    closeCallbacks.push(() => app.close());
    const createRequest = {
      branch: worktree.branch,
      expectedSnapshot: "a".repeat(64),
    };

    const listed = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/git/worktrees?rootPath=${encodedProjectRootPath}`,
    });
    const created = await app.inject({
      headers: { "idempotency-key": "create-worktree" },
      method: "POST",
      payload: createRequest,
      url: `/v1/projects/codexly/git/worktrees?rootPath=${encodedProjectRootPath}`,
    });
    const repeated = await app.inject({
      headers: { "idempotency-key": "create-worktree" },
      method: "POST",
      payload: createRequest,
      url: `/v1/projects/codexly/git/worktrees?rootPath=${encodedProjectRootPath}`,
    });
    const switched = await app.inject({
      headers: { "idempotency-key": "switch-worktree" },
      method: "POST",
      payload: { path: worktree.path },
      url: `/v1/projects/codexly/git/worktree?rootPath=${encodedProjectRootPath}`,
    });

    expect(listed.json()).toEqual({ worktrees: [worktree] });
    expect(created.json()).toEqual({ project: targetProject, worktree });
    expect(repeated.json()).toEqual({ project: targetProject, worktree });
    expect(switched.json()).toEqual({ project: targetProject, worktree });
    expect(createProjectWorktree).toHaveBeenCalledOnce();
    expect(createProjectWorktree).toHaveBeenCalledWith(projectRootPath, createRequest);
    expect(resolveProjectWorktree).toHaveBeenCalledWith(projectRootPath, worktree.path);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("maps invalid worktree switches and creation failures", async () => {
    const { provider } = createProvider();
    const createProjectWorktree = vi
      .fn()
      .mockRejectedValue(new GitWorktreeError("CREATE_FAILED", "fatal: worktree path is locked"));
    const resolveProjectWorktree = vi
      .fn()
      .mockRejectedValue(new GitWorktreeError("WORKTREE_NOT_FOUND", "Git worktree was not found"));
    const app = await createCodexlyServer(
      createServerOptions(provider, { createProjectWorktree, resolveProjectWorktree }),
    );
    closeCallbacks.push(() => app.close());

    const created = await app.inject({
      headers: { "idempotency-key": "create-worktree-failed" },
      method: "POST",
      payload: { branch: "feat/worktree", expectedSnapshot: "a".repeat(64) },
      url: `/v1/projects/codexly/git/worktrees?rootPath=${encodedProjectRootPath}`,
    });
    const switched = await app.inject({
      headers: { "idempotency-key": "switch-worktree-missing" },
      method: "POST",
      payload: { path: "/workspace/missing" },
      url: `/v1/projects/codexly/git/worktree?rootPath=${encodedProjectRootPath}`,
    });

    expect(created.statusCode).toBe(502);
    expect(created.json()).toMatchObject({
      code: "GIT_WORKTREE_CREATE_FAILED",
      message: "fatal: worktree path is locked",
    });
    expect(switched.statusCode).toBe(409);
    expect(switched.json()).toMatchObject({ code: "GIT_WORKTREE_NOT_FOUND" });
  });
});
