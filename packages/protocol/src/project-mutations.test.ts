import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  CommitProjectChangesRequestSchema,
  CommitProjectChangesResponseSchema,
  CreateProjectWorktreeRequestSchema,
  CreateProjectBranchRequestSchema,
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
  ProjectGitWorktreePageSchema,
  ProjectWorktreeMutationResponseSchema,
  SwitchProjectBranchRequestSchema,
  SwitchProjectWorktreeRequestSchema,
  ProjectOpenAppSchema,
  ProjectOpenCapabilitiesResponseSchema,
  OpenProjectRequestSchema,
  OpenProjectResponseSchema,
  ProjectSchema,
  RenameProjectRequestSchema,
  RenameProjectResponseSchema,
  ReorderProjectsRequestSchema,
  ReorderProjectsResponseSchema,
  RemoveProjectRequestSchema,
  RemoveProjectResponseSchema,
} from "./project.js";

describe("project mutation protocol", () => {
  it("defines a public project with ordered roots", () => {
    expect(ProjectSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        createdAt: { format: "date-time", type: "string" },
        id: { minLength: 1, type: "string" },
        name: { minLength: 1, type: "string" },
        roots: { minItems: 1, type: "array", uniqueItems: true },
      },
      type: "object",
    });
    expect(ProjectSchema.required).toEqual(["createdAt", "id", "name", "roots"]);
  });

  it("requires a complete non-duplicated project order", () => {
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["superwork", "code-agent"],
      }),
    ).toBe(true);
    expect(Value.Check(ReorderProjectsRequestSchema, { projectIds: [] })).toBe(false);
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["code-agent", "code-agent"],
      }),
    ).toBe(false);
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["code-agent"],
        staleOrder: true,
      }),
    ).toBe(false);
    expect(
      Value.Check(ReorderProjectsResponseSchema, {
        data: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
  });

  it("strictly validates project display-name and removal mutations", () => {
    expect(Value.Check(RenameProjectRequestSchema, { name: "工作区别名" })).toBe(true);
    expect(Value.Check(RenameProjectRequestSchema, { name: "   " })).toBe(false);
    expect(Value.Check(RenameProjectRequestSchema, { name: "x".repeat(201) })).toBe(false);
    expect(
      Value.Check(RenameProjectResponseSchema, {
        project: {
          createdAt: "2026-07-25T00:00:00.000Z",
          id: "code-agent",
          name: "工作区别名",
          roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
        },
      }),
    ).toBe(true);
    expect(Value.Check(RemoveProjectRequestSchema, {})).toBe(true);
    expect(Value.Check(RemoveProjectRequestSchema, { removeFromDisk: true })).toBe(false);
    expect(
      Value.Check(RemoveProjectResponseSchema, {
        projectId: "code-agent",
        status: "removed",
      }),
    ).toBe(true);
  });

  it("strictly validates the supported project open app catalog", () => {
    expect(
      Value.Check(ProjectOpenCapabilitiesResponseSchema, {
        apps: [
          { id: "zed", kind: "editor", name: "Zed" },
          { id: "system-default", kind: "system-default", name: "系统默认应用" },
          { id: "finder", kind: "file-manager", name: "Finder" },
          { id: "ghostty", kind: "terminal", name: "Ghostty" },
        ],
        platform: "darwin",
      }),
    ).toBe(true);
    expect(Value.Check(ProjectOpenAppSchema, { id: "zed", kind: "editor" })).toBe(false);
    expect(Value.Check(OpenProjectRequestSchema, { appId: "zed" })).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, { appId: "system-default", path: "README.md" }),
    ).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, {
        appId: "system-default",
        path: "/workspace/CodeAgent/report.docx",
      }),
    ).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, {
        appId: "system-default",
        path: "C:\\workspace\\CodeAgent\\slides.pptx",
      }),
    ).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, { appId: "zed", path: "src/components/app.tsx" }),
    ).toBe(true);
    expect(Value.Check(OpenProjectRequestSchema, { appId: "custom-command" })).toBe(false);
    for (const path of ["", "bad\npath.doc", "bad\0path.doc"]) {
      expect(Value.Check(OpenProjectRequestSchema, { appId: "finder", path })).toBe(false);
    }
    expect(Value.Check(OpenProjectResponseSchema, { appId: "ghostty" })).toBe(true);
    expect(
      Value.Check(OpenProjectResponseSchema, { appId: "ghostty", path: "src/components" }),
    ).toBe(true);
    expect(
      Value.Check(ProjectOpenCapabilitiesResponseSchema, {
        platform: "darwin",
        targets: ["folder", "vscode", "terminal"],
      }),
    ).toBe(false);
  });

  it("strictly validates selected-file commit generation and mutation contracts", () => {
    const snapshot = "a".repeat(64);
    const paths = ["packages/server/src/app.ts", "apps/web/src/app.tsx"];

    expect(
      Value.Check(GenerateCommitMessageRequestSchema, {
        expectedSnapshot: snapshot,
        paths,
        repository: "frontend",
      }),
    ).toBe(true);
    expect(
      Value.Check(GenerateCommitMessageResponseSchema, {
        message: "feat(git): 添加选择文件提交",
        snapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(CommitProjectChangesRequestSchema, {
        action: "commit_and_push",
        expectedSnapshot: snapshot,
        message: "feat(git): 添加选择文件提交",
        paths,
        repository: "frontend",
      }),
    ).toBe(true);
    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        branch: "feat/commit",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: "feat(git): 添加选择文件提交",
        pushError: null,
        pushStatus: "pushed",
      }),
    ).toBe(true);

    for (const invalidPaths of [
      [],
      ["src/app.ts", "src/app.ts"],
      ["../secret"],
      ["/tmp/secret"],
      ["src\\app.ts"],
    ]) {
      expect(
        Value.Check(GenerateCommitMessageRequestSchema, {
          expectedSnapshot: snapshot,
          paths: invalidPaths,
        }),
      ).toBe(false);
    }
    expect(
      Value.Check(CommitProjectChangesRequestSchema, {
        action: "commit",
        expectedSnapshot: "stale",
        message: "   ",
        paths,
      }),
    ).toBe(false);
    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        branch: null,
        commitSha: "not-a-sha",
        message: "fix(git): 修复提交",
        pushError: null,
        pushStatus: "unknown",
      }),
    ).toBe(false);
    expect(
      Value.Check(GenerateCommitMessageRequestSchema, {
        expectedSnapshot: snapshot,
        paths,
        repository: "../server",
      }),
    ).toBe(false);
    expect(
      Value.Check(GenerateCommitMessageRequestSchema, {
        expectedSnapshot: snapshot,
        paths,
        repository: "packages/server",
      }),
    ).toBe(false);
  });

  it("strictly validates branch-switch mutations", () => {
    const expectedSnapshot = "a".repeat(64);

    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "feat/branch-switching",
        expectedSnapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "main",
        command: "reset --hard",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "main",
        expectedSnapshot: "stale",
      }),
    ).toBe(false);
  });

  it("strictly validates branch-creation mutations", () => {
    const expectedSnapshot = "a".repeat(64);

    expect(
      Value.Check(CreateProjectBranchRequestSchema, {
        branch: "feat/create-branch",
        expectedSnapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateProjectBranchRequestSchema, {
        branch: "",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(
      Value.Check(CreateProjectBranchRequestSchema, {
        branch: "feat/create-branch",
        command: "checkout -B main",
        expectedSnapshot,
      }),
    ).toBe(false);
  });

  it("strictly validates project worktree queries and mutations", () => {
    const expectedSnapshot = "a".repeat(64);
    const worktree = {
      branch: "feat/worktree",
      current: false,
      path: "/workspace/CodeAgent-feat-worktree",
    };
    const project = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "code-agent-feat-worktree",
      name: "CodeAgent-feat-worktree",
      roots: [{ id: "root-code-agent-feat-worktree", path: worktree.path }],
    };

    expect(Value.Check(ProjectGitWorktreePageSchema, { worktrees: [worktree] })).toBe(true);
    expect(
      Value.Check(ProjectGitWorktreePageSchema, {
        worktrees: [{ ...worktree, command: "status" }],
      }),
    ).toBe(false);
    expect(
      Value.Check(CreateProjectWorktreeRequestSchema, {
        branch: worktree.branch,
        expectedSnapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateProjectWorktreeRequestSchema, {
        branch: "",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(Value.Check(SwitchProjectWorktreeRequestSchema, { path: worktree.path })).toBe(true);
    expect(Value.Check(SwitchProjectWorktreeRequestSchema, { path: "relative/path" })).toBe(false);
    expect(Value.Check(ProjectWorktreeMutationResponseSchema, { project, worktree })).toBe(true);
    expect(
      Value.Check(ProjectWorktreeMutationResponseSchema, {
        project,
        worktree: { ...worktree, path: "relative/path" },
      }),
    ).toBe(false);
  });
});
