import { describe, expect, it, vi } from "vitest";
import { buildProjectImageFileUrl, CodexlyClient } from "./http-client.js";
import { projectRootPath, jsonResponse } from "./http-client.test-support.js";

describe("CodexlyClient Git routes", () => {
  it("reads and validates a project's staged and unstaged Git changes", async () => {
    const gitStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/review",
      branches: ["feat/review", "main"],
      repositoryMode: "root",
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [
        {
          diff: "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+export {};",
          kind: "create",
          path: "new.ts",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.getProjectGitStatus("project one", {
        includeDiff: true,
        repository: "frontend",
        rootPath: projectRootPath,
      }),
    ).resolves.toEqual(gitStatus);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/git/status?includeDiff=true&repository=frontend&rootPath=%2Fworkspace%2FCodexly",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ staged: [], unstaged: [] }));
    await expect(
      client.getProjectGitStatus("project one", { rootPath: projectRootPath }),
    ).rejects.toThrow("Codexly response does not match the protocol schema");
  });

  it("reads and validates a paginated project Git history tab", async () => {
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
      repository: "frontend",
      repositoryMode: "children",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(historyPage));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.getProjectGitHistory("project one", {
        cursor: "20",
        repository: "packages/server",
        rootPath: projectRootPath,
      }),
    ).resolves.toEqual(historyPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/git/history?cursor=20&repository=packages%2Fserver&rootPath=%2Fworkspace%2FCodexly",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...historyPage, commits: [{}] }));
    await expect(
      client.getProjectGitHistory("project one", { rootPath: projectRootPath }),
    ).rejects.toThrow("Codexly response does not match the protocol schema");
  });

  it("reads and validates paginated commit files and one bounded diff", async () => {
    const filesPage = {
      files: [{ kind: "update", path: "src/index.ts" }],
      nextCursor: "100",
    };
    const diff = { diff: "@@ -1 +1 @@\n-old\n+new\n", truncated: false };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse(filesPage));
    fetchMock.mockResolvedValueOnce(jsonResponse(diff));
    const client = new CodexlyClient({ fetch: fetchMock });
    const sha = "a".repeat(40);

    await expect(
      client.getProjectGitCommitFiles("project one", {
        cursor: "100",
        repository: "packages/server",
        rootPath: projectRootPath,
        sha,
      }),
    ).resolves.toEqual(filesPage);
    await expect(
      client.getProjectGitCommitFileDiff("project one", {
        path: "src/index.ts",
        repository: "packages/server",
        rootPath: projectRootPath,
        sha,
      }),
    ).resolves.toEqual(diff);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/v1/projects/project%20one/git/commit-files?cursor=100&repository=packages%2Fserver&rootPath=%2Fworkspace%2FCodexly&sha=${sha}`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/v1/projects/project%20one/git/commit-diff?path=src%2Findex.ts&repository=packages%2Fserver&rootPath=%2Fworkspace%2FCodexly&sha=${sha}`,
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [{ path: "src/index.ts" }] }));
    await expect(
      client.getProjectGitCommitFiles("project one", { rootPath: projectRootPath, sha }),
    ).rejects.toThrow("Codexly response does not match the protocol schema");
  });

  it("switches a project branch with a validated idempotent mutation", async () => {
    const gitStatus = {
      baseBranches: ["origin/main", "feat/review"],
      branch: "main",
      branches: ["main", "feat/review"],
      repositoryMode: "root",
      snapshot: "b".repeat(64),
      staged: [],
      unstaged: [],
    };
    const request = { branch: "main", expectedSnapshot: "a".repeat(64) };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.switchProjectBranch("project one", projectRootPath, request, {
        idempotencyKey: "switch-key",
      }),
    ).resolves.toEqual(gitStatus);
    const switchCall = fetchMock.mock.calls[0];
    expect(switchCall?.[0]).toBe(
      "/v1/projects/project%20one/git/branch?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(switchCall?.[1]).toMatchObject({ body: JSON.stringify(request), method: "POST" });
    expect(new Headers(switchCall?.[1]?.headers).get("idempotency-key")).toBe("switch-key");

    fetchMock.mockResolvedValueOnce(jsonResponse({ branch: "main" }));
    await expect(
      client.switchProjectBranch("project one", projectRootPath, request),
    ).rejects.toThrow("Codexly response does not match the protocol schema");
  });

  it("creates a project branch with a validated idempotent mutation", async () => {
    const gitStatus = {
      baseBranches: ["origin/main", "main"],
      branch: "feat/new-branch",
      branches: ["feat/new-branch", "main"],
      repositoryMode: "root",
      snapshot: "b".repeat(64),
      staged: [],
      unstaged: [],
    };
    const request = { branch: "feat/new-branch", expectedSnapshot: "a".repeat(64) };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(gitStatus));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.createProjectBranch("project one", projectRootPath, request, {
        idempotencyKey: "create-key",
      }),
    ).resolves.toEqual(gitStatus);
    const createCall = fetchMock.mock.calls[0];
    expect(createCall?.[0]).toBe(
      "/v1/projects/project%20one/git/branches?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(createCall?.[1]).toMatchObject({ body: JSON.stringify(request), method: "POST" });
    expect(new Headers(createCall?.[1]?.headers).get("idempotency-key")).toBe("create-key");

    fetchMock.mockResolvedValueOnce(jsonResponse({ branch: "feat/new-branch" }));
    await expect(
      client.createProjectBranch("project one", projectRootPath, request),
    ).rejects.toThrow("Codexly response does not match the protocol schema");
  });

  it("lists, creates, and switches project worktrees through validated routes", async () => {
    const worktree = {
      branch: "feat/worktree",
      current: false,
      path: "/workspace/Codexly-feat-worktree",
    };
    const page = { worktrees: [worktree] };
    const response = {
      project: {
        createdAt: "2026-08-18T00:00:00.000Z",
        id: "codexly-feat-worktree",
        name: "Codexly-feat-worktree",
        roots: [{ id: "root-codexly-feat-worktree", path: worktree.path }],
      },
      worktree,
    };
    const createRequest = {
      branch: worktree.branch,
      expectedSnapshot: "a".repeat(64),
    };
    const switchRequest = { path: worktree.path };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(page))
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(jsonResponse(response));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.listProjectWorktrees("project one", projectRootPath)).resolves.toEqual(
      page,
    );
    await expect(
      client.createProjectWorktree("project one", projectRootPath, createRequest, {
        idempotencyKey: "create-worktree-key",
      }),
    ).resolves.toEqual(response);
    await expect(
      client.switchProjectWorktree("project one", projectRootPath, switchRequest, {
        idempotencyKey: "switch-worktree-key",
      }),
    ).resolves.toEqual(response);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/git/worktrees?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/projects/project%20one/git/worktrees?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify(createRequest),
      method: "POST",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/v1/projects/project%20one/git/worktree?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify(switchRequest),
      method: "POST",
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ worktrees: [{ path: "relative/path" }] }));
    await expect(client.listProjectWorktrees("project one", projectRootPath)).rejects.toThrow(
      "Codexly response does not match the protocol schema",
    );
  });

  it("generates a commit message and commits selected files with idempotency", async () => {
    const snapshot = "a".repeat(64);
    const generationRequest = {
      expectedSnapshot: snapshot,
      paths: ["src/app.ts"],
      repository: "packages/server",
    };
    const commitRequest = {
      action: "commit_and_push" as const,
      expectedSnapshot: snapshot,
      message: "feat(git): 添加选择文件提交",
      paths: generationRequest.paths,
      repository: generationRequest.repository,
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "feat(git): 添加选择文件提交", snapshot }))
      .mockResolvedValueOnce(
        jsonResponse({
          branch: "feat/commit",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: commitRequest.message,
          pushError: null,
          pushStatus: "pushed",
        }),
      );
    const client = new CodexlyClient({ fetch: fetchMock });

    await client.generateCommitMessage("project one", projectRootPath, generationRequest, {
      idempotencyKey: "generate-key",
    });
    await client.commitProjectChanges("project one", projectRootPath, commitRequest, {
      idempotencyKey: "commit-key",
    });

    const [generateCall, commitCall] = fetchMock.mock.calls;
    expect(generateCall?.[0]).toBe(
      "/v1/projects/project%20one/git/commit-message?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(generateCall?.[1]).toMatchObject({
      body: JSON.stringify(generationRequest),
      method: "POST",
    });
    expect(new Headers(generateCall?.[1]?.headers).get("idempotency-key")).toBe("generate-key");
    expect(commitCall?.[0]).toBe(
      "/v1/projects/project%20one/git/commits?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(commitCall?.[1]).toMatchObject({ body: JSON.stringify(commitRequest), method: "POST" });
    expect(new Headers(commitCall?.[1]?.headers).get("idempotency-key")).toBe("commit-key");
  });

  it("reads and validates a paginated project source preview", async () => {
    const sourceFile = {
      content: "### 11.7 认证\n",
      nextCursor: 262_144,
      path: "docs/architecture-design.md",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(sourceFile));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.readProjectSourceFile(
        "project one",
        projectRootPath,
        "/workspace/Codexly/docs/architecture-design.md",
        131_072,
      ),
    ).resolves.toEqual(sourceFile);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/source?cursor=131072&path=%2Fworkspace%2FCodexly%2Fdocs%2Farchitecture-design.md&rootPath=%2Fworkspace%2FCodexly",
    );
  });

  it("uses the public temporary scope for common file capabilities", async () => {
    const capabilities = {
      apps: [{ id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" }],
      platform: "darwin",
    };
    const sourceFile = { content: "# 临时记录\n", nextCursor: null, path: "/tmp/notes.md" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(capabilities))
      .mockResolvedValueOnce(jsonResponse(sourceFile))
      .mockResolvedValueOnce(jsonResponse({ appId: "system-default", path: "/tmp/report.pdf" }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await client.getProjectOpenCapabilities("temporary");
    await client.readProjectSourceFile("temporary", undefined, "/tmp/notes.md");
    await client.openProject(
      "temporary",
      undefined,
      { appId: "system-default", path: "/tmp/report.pdf" },
      { idempotencyKey: "open-temporary-file" },
    );

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/v1/temporary/open-capabilities",
      "/v1/temporary/files/source?path=%2Ftmp%2Fnotes.md",
      "/v1/temporary/open",
    ]);
    expect(buildProjectImageFileUrl("", "temporary", "/tmp/result.png")).toBe(
      "/v1/temporary/files/image?path=%2Ftmp%2Fresult.png",
    );
  });

  it("reads and validates a project file tree directory", async () => {
    const fileTree = {
      entries: [{ path: "src/components/app.tsx", type: "file" }],
      path: "src/components",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(fileTree));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.listProjectFiles("project one", projectRootPath, "src/components"),
    ).resolves.toEqual(fileTree);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/tree?path=src%2Fcomponents&rootPath=%2Fworkspace%2FCodexly",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ entries: [{ path: "/absolute.ts", type: "file" }], path: null }),
    );
    await expect(client.listProjectFiles("project one", projectRootPath, null)).rejects.toThrow(
      "Codexly response does not match the protocol schema",
    );
  });

  it("searches and validates project file references", async () => {
    const page = {
      data: [
        {
          name: "index.ts",
          path: "src/index.ts",
          rootId: "root-codexly",
          rootPath: projectRootPath,
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(page));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.searchProjectFiles("project one", projectRootPath, "index", "search-1"),
    ).resolves.toEqual(page);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/files/search?query=index&rootPath=%2Fworkspace%2FCodexly&sessionId=search-1",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      client.stopProjectFileSearch("project one", projectRootPath, "search-1", {
        idempotencyKey: "stop-search-1",
      }),
    ).resolves.toEqual({});
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects/project%20one/files/search/stop");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ rootPath: projectRootPath, sessionId: "search-1" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "stop-search-1",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ name: "outside.ts", path: "/tmp/outside.ts" }] }),
    );
    await expect(
      client.searchProjectFiles("project one", projectRootPath, "outside", "search-1"),
    ).rejects.toThrow("Codexly response does not match the protocol schema");
  });
});
