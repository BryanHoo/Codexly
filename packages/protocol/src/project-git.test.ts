import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { CommitProjectChangesResponseSchema } from "./project-git.js";

describe("CommitProjectChangesResponseSchema", () => {
  it("carries the original push error for partial Git success", () => {
    const base = {
      branch: "main",
      commitSha: "a".repeat(40),
      message: "fix(git): preserve errors",
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
