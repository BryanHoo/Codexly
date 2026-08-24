import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AgentPromptInputSchema,
  ProjectFileTreeQuerySchema,
  ProjectFileSearchPageSchema,
  ProjectFileSearchQuerySchema,
  StopProjectFileSearchRequestSchema,
  StopProjectFileSearchResponseSchema,
  ProjectGitHistoryPageSchema,
  ProjectGitHistoryQuerySchema,
  ProjectGitCommitFileDiffQuerySchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitCommitFilesQuerySchema,
  ProjectGitStatusQuerySchema,
  ProjectGitStatusSchema,
  ProjectFileTreeSchema,
  ProjectSourceFileQuerySchema,
  ProjectSourceFileSchema,
} from "./project.js";

const rootPath = "/workspace/Codexly";

describe("project repository protocol", () => {
  it("describes Git branches with staged and unstaged file changes", () => {
    const fileChange = {
      diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new",
      kind: "update",
      path: "src/index.ts",
    };

    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: ["origin/main", "main"],
        branch: "feat/review",
        branches: ["feat/review", "main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [fileChange],
        unstaged: [{ ...fileChange, path: "README.md" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: [],
        branch: null,
        branches: [],
        repositoryMode: "none",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        staged: [],
        unstaged: [],
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: ["origin/main", "origin/main"],
        branch: null,
        branches: [],
        repositoryMode: "children",
        snapshot: "a".repeat(64),
        staged: [],
        unstaged: [],
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: ["main"],
        branch: "feat/review",
        branches: ["feat/review", "main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [{ ...fileChange, path: "/workspace/Codexly/src/index.ts" }],
        unstaged: [],
      }),
    ).toBe(false);
  });

  it("validates Git status detail and repository selectors", () => {
    expect(Value.Check(ProjectGitStatusQuerySchema, {})).toBe(false);
    expect(
      Value.Check(ProjectGitStatusQuerySchema, {
        includeDiff: true,
        repository: "frontend",
        rootPath,
      }),
    ).toBe(true);
    expect(Value.Check(ProjectGitStatusQuerySchema, { includeDiff: "true", rootPath })).toBe(false);
    expect(
      Value.Check(ProjectGitStatusQuerySchema, { repository: "packages/server", rootPath }),
    ).toBe(false);
    expect(Value.Check(ProjectGitStatusQuerySchema, { repository: "../server", rootPath })).toBe(
      false,
    );
  });

  it("strictly validates paginated Git history contracts", () => {
    const commit = {
      authoredAt: "2026-08-06T08:30:00+08:00",
      authorEmail: "developer@example.com",
      authorName: "Developer",
      sha: "a".repeat(40),
      title: "feat(git): 添加历史记录",
    };

    expect(Value.Check(ProjectGitHistoryQuerySchema, {})).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryQuerySchema, {
        cursor: "20",
        repository: "packages/server",
        rootPath,
      }),
    ).toBe(true);
    expect(Value.Check(ProjectGitHistoryQuerySchema, { cursor: "sha-20", rootPath })).toBe(false);
    expect(Value.Check(ProjectGitHistoryQuerySchema, { repository: "../server", rootPath })).toBe(
      false,
    );
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "feat/apps-web",
        commits: [commit, { ...commit, sha: "b".repeat(64) }],
        nextCursor: "20",
        repositories: ["apps/web", "packages/server"],
        repository: "apps/web",
        repositoryMode: "children",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "main",
        commits: [{ ...commit, sha: "not-a-sha" }],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "main",
        commits: [{ ...commit, authoredAt: "yesterday" }],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "release/server",
        commits: [commit],
        nextCursor: "next",
        repositories: ["packages/server"],
        repository: "packages/server",
        repositoryMode: "children",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: null,
        commits: [{ ...commit, body: "unexpected" }],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "main",
        commits: Array.from({ length: 21 }, (_, index) => ({
          ...commit,
          sha: index.toString(16).padStart(40, "0"),
        })),
        nextCursor: "20",
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        commits: [commit],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
  });

  it("strictly validates bounded Git commit review contracts", () => {
    const sha = "a".repeat(40);
    expect(
      Value.Check(ProjectGitCommitFilesQuerySchema, {
        cursor: "100",
        repository: "packages/server",
        rootPath,
        sha,
      }),
    ).toBe(true);
    expect(Value.Check(ProjectGitCommitFilesQuerySchema, { rootPath, sha: "HEAD" })).toBe(false);
    expect(
      Value.Check(ProjectGitCommitFileDiffQuerySchema, {
        path: "src/index.ts",
        rootPath,
        sha,
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitCommitFileDiffQuerySchema, {
        path: "../secret.txt",
        rootPath,
        sha,
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitCommitFilesPageSchema, {
        files: Array.from({ length: 100 }, (_, index) => ({
          kind: "update",
          path: `src/file-${String(index)}.ts`,
        })),
        nextCursor: "100",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitCommitFilesPageSchema, {
        files: Array.from({ length: 101 }, (_, index) => ({
          kind: "update",
          path: `src/file-${String(index)}.ts`,
        })),
        nextCursor: null,
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitCommitFileDiffSchema, {
        diff: "@@ -1 +1 @@\n-old\n+new\n",
        truncated: true,
      }),
    ).toBe(true);
  });

  it("describes a paginated project source file preview", () => {
    expect(
      Value.Check(ProjectSourceFileQuerySchema, {
        cursor: 262_144,
        path: "docs/architecture-design.md",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileQuerySchema, {
        cursor: -1,
        path: "docs/architecture-design.md",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        nextCursor: 15,
        path: "docs/architecture-design.md",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        nextCursor: null,
        path: "/workspace/Codexly/docs/architecture-design.md",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        path: "docs/architecture-design.md",
        truncated: true,
      }),
    ).toBe(false);
  });

  it("describes an unbounded project-relative directory listing", () => {
    expect(
      Value.Check(ProjectFileTreeSchema, {
        entries: Array.from({ length: 2_001 }, (_, index) => ({
          path: `src/file-${String(index)}.ts`,
          type: "file",
        })),
        path: "src",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectFileTreeSchema, {
        entries: [{ path: "/workspace/Codexly/src", type: "directory" }],
        path: null,
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectFileTreeSchema, {
        entries: [{ extra: true, path: "src", type: "directory" }],
        path: null,
      }),
    ).toBe(false);
    expect(Value.Check(ProjectFileTreeSchema, { entries: [], path: null, truncated: false })).toBe(
      false,
    );
  });

  it("validates optional project-relative file tree directory queries", () => {
    expect(Value.Check(ProjectFileTreeQuerySchema, {})).toBe(true);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "src/components" })).toBe(true);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "/workspace/src" })).toBe(false);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "../src" })).toBe(false);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "." })).toBe(false);
    expect(Value.Check(ProjectFileTreeQuerySchema, { extra: true })).toBe(false);
  });

  it("validates bounded project file searches and path text prompts", () => {
    expect(
      Value.Check(ProjectFileSearchQuerySchema, { query: "index", sessionId: "search-1" }),
    ).toBe(true);
    expect(Value.Check(ProjectFileSearchQuerySchema, { query: "index" })).toBe(false);
    expect(
      Value.Check(ProjectFileSearchQuerySchema, {
        query: "x".repeat(257),
        sessionId: "search-1",
      }),
    ).toBe(false);
    expect(
      Value.Check(StopProjectFileSearchRequestSchema, {
        rootPath,
        sessionId: "search-1",
      }),
    ).toBe(true);
    expect(Value.Check(StopProjectFileSearchRequestSchema, { sessionId: "search-1" })).toBe(true);
    expect(Value.Check(StopProjectFileSearchRequestSchema, { sessionId: "" })).toBe(false);
    expect(Value.Check(StopProjectFileSearchResponseSchema, {})).toBe(true);
    expect(
      Value.Check(ProjectFileSearchPageSchema, {
        data: [
          {
            name: "index.ts",
            path: "src/index.ts",
            rootId: "root-codexly",
            rootPath: "/workspace/Codexly",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectFileSearchPageSchema, {
        data: [
          {
            name: "outside.ts",
            path: "/tmp/outside.ts",
            rootId: "root-codexly",
            rootPath: "/workspace/Codexly",
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [],
        text: "@src/index.ts",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        fileReferences: [{ path: "src/index.ts" }],
        skills: [],
        text: "@src/index.ts",
        type: "prompt",
      }),
    ).toBe(false);
  });
});
