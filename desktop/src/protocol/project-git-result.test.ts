import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { CommitProjectChangesResponseSchema } from "./project-git.js";

it("preserves a successful commit with an independent index synchronization failure", () => {
  const response = {
    branch: "main", commitSha: "a".repeat(40), message: "fix(test): 保留提交结果",
    pushError: null, pushStatus: "not_requested", indexSyncError: "GIT_INDEX_SYNC_FAILED",
  };
  expect(Value.Check(CommitProjectChangesResponseSchema, response)).toBe(true);
  expect(Value.Check(CommitProjectChangesResponseSchema, { ...response, indexSyncError: null })).toBe(true);
  expect(Value.Check(CommitProjectChangesResponseSchema, { ...response, indexSyncError: "unknown" })).toBe(false);
});
