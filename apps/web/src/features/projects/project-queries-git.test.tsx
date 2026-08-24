import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  type CodeAgentGitHistoryClient,
  type CodeAgentGitCommitReviewClient,
  type CodeAgentGitStatusClient,
  type CodeAgentFileTreeClient,
  type CodeAgentMcpServersClient,
  mcpServersQueryOptions,
  mcpServersReloadMutationOptions,
  projectGitHistoryInfiniteQueryOptions,
  projectGitCommitFileDiffQueryOptions,
  projectGitCommitFilesInfiniteQueryOptions,
  projectGitStatusQueryOptions,
  projectGitDetailedStatusQueryOptions,
  projectGitRepositoryStatusQueryOptions,
  projectFileTreeQueryOptions,
  flattenProjectTaskPages,
  removeProjectTaskFromInfiniteData,
  reorderProjectPage,
  replaceProjectTaskInInfiniteData,
  upsertProjectTaskInInfiniteData,
  upsertProjectInPage,
} from "./project-queries.js";
import { project, rootPath, task } from "./project-queries.test-support.js";

describe("project Git queries", () => {
  it("inserts or replaces a worktree project without changing sibling order", () => {
    const worktreeProject = {
      ...project,
      id: "code-agent-worktree",
      name: "CodeAgent-worktree",
      rootPath: "/workspace/CodeAgent-worktree",
    };
    const page = { data: [project], nextCursor: null };

    expect(upsertProjectInPage(undefined, worktreeProject)).toEqual({
      data: [worktreeProject],
      nextCursor: null,
    });
    expect(upsertProjectInPage(page, worktreeProject).data).toEqual([project, worktreeProject]);
    expect(
      upsertProjectInPage(
        { data: [project, worktreeProject], nextCursor: null },
        { ...worktreeProject, name: "Review worktree" },
      ).data,
    ).toEqual([project, { ...worktreeProject, name: "Review worktree" }]);
  });

  it("inserts a created task immediately and replaces it when fresh metadata arrives", () => {
    const initialData = {
      pageParams: [undefined, "next-page"],
      pages: [
        { data: [task], nextCursor: "next-page" },
        { data: [{ ...task, id: "task-older" }], nextCursor: null },
      ],
    };
    const createdTask = {
      ...task,
      id: "task-created",
      title: "新聊天",
      updatedAt: "2026-07-26T08:00:00.000Z",
    };
    const materializedTask = { ...createdTask, title: "发送你好" };

    const insertedData = upsertProjectTaskInInfiniteData(initialData, createdTask);
    const refreshedData = upsertProjectTaskInInfiniteData(insertedData, materializedTask);

    expect(flattenProjectTaskPages(insertedData)).toEqual([
      createdTask,
      task,
      { ...task, id: "task-older" },
    ]);
    expect(flattenProjectTaskPages(refreshedData)).toEqual([
      materializedTask,
      task,
      { ...task, id: "task-older" },
    ]);
    expect(refreshedData).toMatchObject({
      pageParams: [undefined, "next-page"],
      pages: [{ nextCursor: "next-page" }, { nextCursor: null }],
    });
  });

  it("replaces and removes task metadata without changing sibling order", () => {
    const sibling = { ...task, id: "task-2", title: "Sibling" };
    const infiniteData = {
      pageParams: [undefined, "next-page"],
      pages: [
        { data: [sibling], nextCursor: "next-page" },
        { data: [task], nextCursor: null },
      ],
    };

    const replacedData = replaceProjectTaskInInfiniteData(infiniteData, {
      ...task,
      pinned: true,
    });
    const removedData = removeProjectTaskFromInfiniteData(infiniteData, task.id);

    expect(flattenProjectTaskPages(replacedData)).toEqual([sibling, { ...task, pinned: true }]);
    expect(flattenProjectTaskPages(removedData)).toEqual([sibling]);
    expect(removedData).toMatchObject({
      pageParams: [undefined, "next-page"],
      pages: [{ nextCursor: "next-page" }, { nextCursor: null }],
    });
  });

  it("reorders a complete project page and rejects stale project sets", () => {
    const secondProject = { ...project, id: "superwork", name: "superwork" };
    const page = { data: [project, secondProject], nextCursor: null };

    expect(reorderProjectPage(page, [secondProject.id, project.id])).toEqual({
      data: [secondProject, project],
      nextCursor: null,
    });
    expect(reorderProjectPage(page, [project.id])).toBeUndefined();
    expect(reorderProjectPage(page, [project.id, "missing"])).toBeUndefined();
    expect(reorderProjectPage(page, [project.id, project.id])).toBeUndefined();
  });

  it("loads shared Project Git status without owning a polling interval", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({
        baseBranches: ["origin/main"],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitStatusQueryOptions("code-agent", rootPath, {
      getProjectGitStatus,
    });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual({
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main"],
      repositoryMode: "root",
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    });
    expect(options.queryKey).toEqual(["projects", "code-agent", rootPath, "git-status"]);
    expect(options.refetchInterval).toBeUndefined();
    expect(getProjectGitStatus.mock.calls[0]?.[0]).toBe("code-agent");
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({ rootPath });
    expect(getProjectGitStatus.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("isolates an on-demand detailed Git status by repository and snapshot", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({
        baseBranches: ["origin/main"],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitDetailedStatusQueryOptions(
      "code-agent",
      rootPath,
      null,
      "a".repeat(64),
      true,
      { getProjectGitStatus },
    );

    await queryClient.fetchQuery(options);

    expect(options.queryKey).toEqual([
      "projects",
      "code-agent",
      rootPath,
      "git-status-detail",
      null,
      "a".repeat(64),
    ]);
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({ includeDiff: true, rootPath });
  });

  it("loads a selected child repository status into an isolated query", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({
        baseBranches: ["main"],
        branch: "feat/frontend",
        branches: ["feat/frontend", "main"],
        repositoryMode: "root",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitRepositoryStatusQueryOptions(
      "code-agent",
      rootPath,
      "frontend",
      true,
      { getProjectGitStatus },
    );

    await queryClient.fetchQuery(options);

    expect(options.queryKey).toEqual([
      "projects",
      "code-agent",
      rootPath,
      "git-status",
      "frontend",
    ]);
    expect(getProjectGitStatus.mock.calls[0]?.[0]).toBe("code-agent");
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({
      includeDiff: true,
      repository: "frontend",
      rootPath,
    });
    expect(getProjectGitStatus.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("loads Git history twenty commits at a time for one repository tab", async () => {
    const commit = {
      authoredAt: "2026-08-06T08:30:00+08:00",
      authorEmail: "developer@example.com",
      authorName: "Developer",
      sha: "a".repeat(40),
      title: "feat(git): 添加历史记录",
    };
    const getProjectGitHistory = vi
      .fn<CodeAgentGitHistoryClient["getProjectGitHistory"]>()
      .mockResolvedValueOnce({
        branch: "release/server",
        commits: [commit],
        nextCursor: "20",
        repositories: ["apps/web", "packages/server"],
        repository: "packages/server",
        repositoryMode: "children",
      })
      .mockResolvedValueOnce({
        branch: "release/server",
        commits: [{ ...commit, sha: "b".repeat(40) }],
        nextCursor: null,
        repositories: ["apps/web", "packages/server"],
        repository: "packages/server",
        repositoryMode: "children",
      });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitHistoryInfiniteQueryOptions(
      "code-agent",
      rootPath,
      "packages/server",
      true,
      { getProjectGitHistory },
    );
    const observer = new InfiniteQueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await observer.fetchNextPage();

    expect(options.queryKey).toEqual([
      "projects",
      "code-agent",
      rootPath,
      "git-history",
      "packages/server",
    ]);
    expect(getProjectGitHistory.mock.calls[0]?.slice(0, 2)).toEqual([
      "code-agent",
      { repository: "packages/server", rootPath },
    ]);
    expect(getProjectGitHistory.mock.calls[1]?.slice(0, 2)).toEqual([
      "code-agent",
      { cursor: "20", repository: "packages/server", rootPath },
    ]);
    expect(getProjectGitHistory.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      projectGitHistoryInfiniteQueryOptions("code-agent", rootPath, undefined, false, {
        getProjectGitHistory,
      }).enabled,
    ).toBe(false);
    unsubscribe();
  });

  it("isolates paginated commit files and selected file Diff queries", async () => {
    const sha = "a".repeat(40);
    const getProjectGitCommitFiles = vi
      .fn<CodeAgentGitCommitReviewClient["getProjectGitCommitFiles"]>()
      .mockResolvedValueOnce({
        files: [{ kind: "update", path: "src/index.ts" }],
        nextCursor: "100",
      })
      .mockResolvedValueOnce({
        files: [{ kind: "create", path: "src/new.ts" }],
        nextCursor: null,
      });
    const getProjectGitCommitFileDiff = vi
      .fn<CodeAgentGitCommitReviewClient["getProjectGitCommitFileDiff"]>()
      .mockResolvedValue({ diff: "@@ -1 +1 @@", truncated: false });
    const client = { getProjectGitCommitFileDiff, getProjectGitCommitFiles };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filesOptions = projectGitCommitFilesInfiniteQueryOptions(
      "code-agent",
      rootPath,
      "packages/server",
      sha,
      true,
      client,
    );
    const observer = new InfiniteQueryObserver(queryClient, filesOptions);
    const unsubscribe = observer.subscribe(() => undefined);

    await observer.refetch();
    await observer.fetchNextPage();
    const diffOptions = projectGitCommitFileDiffQueryOptions(
      "code-agent",
      rootPath,
      "packages/server",
      sha,
      "index.ts",
      true,
      client,
    );
    await queryClient.fetchQuery(diffOptions);

    expect(filesOptions.queryKey).toEqual([
      "projects",
      "code-agent",
      rootPath,
      "git-commit-files",
      "packages/server",
      sha,
    ]);
    expect(getProjectGitCommitFiles.mock.calls[1]?.[1]).toEqual({
      cursor: "100",
      repository: "packages/server",
      rootPath,
      sha,
    });
    expect(diffOptions.queryKey).toEqual([
      "projects",
      "code-agent",
      rootPath,
      "git-commit-diff",
      "packages/server",
      sha,
      "index.ts",
    ]);
    expect(getProjectGitCommitFileDiff.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    unsubscribe();
  });

  it("loads a project-scoped file tree directory with query cancellation", async () => {
    const listProjectFiles = vi.fn<CodeAgentFileTreeClient["listProjectFiles"]>(() =>
      Promise.resolve({
        entries: [{ path: "src/components", type: "directory" }],
        path: "src",
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectFileTreeQueryOptions("code-agent", rootPath, "src", {
      listProjectFiles,
    });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual({
      entries: [{ path: "src/components", type: "directory" }],
      path: "src",
    });
    expect(options.queryKey).toEqual(["projects", "code-agent", rootPath, "file-tree", "src"]);
    expect(listProjectFiles.mock.calls[0]?.[0]).toBe("code-agent");
    expect(listProjectFiles.mock.calls[0]?.[1]).toBe(rootPath);
    expect(listProjectFiles.mock.calls[0]?.[2]).toBe("src");
    expect(listProjectFiles.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("loads readable MCP servers with a task-scoped query key", async () => {
    const server = {
      authStatus: "unsupported" as const,
      description: null,
      error: null,
      failureReason: null,
      name: "fast-context",
      status: "ready" as const,
      title: null,
      toolCount: 2,
      version: "1.0.0",
    };
    const listMcpServers = vi.fn<CodeAgentMcpServersClient["listMcpServers"]>(() =>
      Promise.resolve({ data: [server] }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = mcpServersQueryOptions("code-agent", "task-1", { listMcpServers });

    await expect(queryClient.fetchQuery(options)).resolves.toEqual({
      data: [server],
    });
    expect(options.queryKey).toEqual(["projects", "code-agent", "tasks", "task-1", "mcp-servers"]);
    expect(options.refetchInterval).toBeUndefined();
    expect(listMcpServers.mock.calls[0]?.[0]).toBe("code-agent");
    expect(listMcpServers.mock.calls[0]?.[1]).toBe("task-1");
    expect(listMcpServers.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reloads MCP servers through a task-scoped serialized mutation", async () => {
    const response = {
      data: [
        {
          authStatus: null,
          description: null,
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "starting" as const,
          title: null,
          toolCount: 0,
          version: null,
        },
      ],
    };
    const retryMcpServers = vi.fn(() => Promise.resolve(response));
    const queryClient = new QueryClient();
    const options = mcpServersReloadMutationOptions("code-agent", "task-1", {
      retryMcpServers,
    });

    await expect(
      queryClient.getMutationCache().build(queryClient, options).execute(undefined),
    ).resolves.toEqual(response);
    expect(retryMcpServers).toHaveBeenCalledWith("code-agent", "task-1");
    expect(options.scope).toEqual({ id: "task-mcp:code-agent:task-1" });
  });

  it("disables the MCP query when no task is selected", () => {
    const listMcpServers = vi.fn<CodeAgentMcpServersClient["listMcpServers"]>();
    const options = mcpServersQueryOptions("code-agent", undefined, { listMcpServers });

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(["projects", "code-agent", "tasks", null, "mcp-servers"]);
    expect(listMcpServers).not.toHaveBeenCalled();
  });
});
