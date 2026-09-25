import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { GenerateCommitMessageRequestSchema, ProjectGitCommitFileSchema, ProjectGitHistoryPageSchema } from "./project-git.js";

describe("Git read protocol", () => {
  it.each(["new/", "目录/文件.txt", "line\nbreak.txt", "literal\\name.txt", "a[1].txt"])("preserves native Git path %j", (path) => {
    expect(Value.Check(ProjectGitCommitFileSchema, { kind: "create", path })).toBe(true);
    expect(Value.Check(GenerateCommitMessageRequestSchema, { expectedSnapshot: "a".repeat(64), paths: [path] })).toBe(true);
  });

  it.each(["/absolute", "../outside", "src/../../outside", "src/./file", "src//file", "nul\0path", "C:/outside"])("rejects invalid Git path %j", (path) => {
    expect(Value.Check(ProjectGitCommitFileSchema, { kind: "create", path })).toBe(false);
  });

  it("accepts empty commit metadata and a non-repository history result", () => {
    expect(Value.Check(ProjectGitHistoryPageSchema, {
      branch: null, commits: [{ sha: "a".repeat(40), authoredAt: "2026-09-15T00:00:00Z", authorName: "", authorEmail: "", title: "" }],
      nextCursor: null, repositories: [], repository: null, repositoryMode: "root",
    })).toBe(true);
    expect(Value.Check(ProjectGitHistoryPageSchema, {
      branch: null, commits: [], nextCursor: null, repositories: [], repository: null, repositoryMode: "none",
    })).toBe(true);
  });
});
