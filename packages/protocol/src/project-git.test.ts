import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { CommitProjectChangesResponseSchema } from "./project-git.js";

describe("CommitProjectChangesResponseSchema", () => {
  it("carries the original push error for partial Git success", () => {
    const base = {
      branch: "main",
      commitSha: "a".repeat(40),
      history: {
        branch: "main",
        commits: [],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      },
      message: "fix(git): preserve errors",
      status: {
        baseBranches: ["origin/main", "main"],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      },
    };

    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        ...base,
        pushError: "fatal: the current branch has no upstream branch",
        pushStatus: "not_configured",
      }),
    ).toBe(true);
    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        ...base,
        pushError: null,
        pushStatus: "pushed",
      }),
    ).toBe(true);
    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        ...base,
        pushStatus: "failed",
      }),
    ).toBe(false);
  });
});
