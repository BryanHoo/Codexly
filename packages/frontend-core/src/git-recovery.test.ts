import { describe, expect, it } from "vitest";
import { classifyGitFailure } from "./git-recovery.js";
describe("Git failure recovery", () => {
  it.each([
    ["Git status changed before the push", "state_changed"],
    ["Git HEAD or branch changed; check the remote status and retry", "state_changed"],
    ["workspace snapshot changed; refresh and retry", "state_changed"],
    ["Commit or set aside working changes before integrating remote updates", "working_changes"],
    ["Resolve and stage all merge conflicts first", "merge_conflicts"],
    ["Invalid remote URL or name", "invalid_remote"],
    ["Authentication failed", "authentication"],
    ["Permission denied (publickey)", "authentication"],
    ["Write access to repository not granted", "permission"],
    ["[rejected] main -> main (non-fast-forward)", "remote_updates"],
    ["GH006: Protected branch update failed", "protected_branch"],
    ["GH013: Repository rule violations found. Commits must have verified signatures", "rules"],
    ["Could not resolve host: github.com", "network"],
    ["Host key verification failed", "host_key"],
    ["pre-receive hook declined", "rules"],
    ["Git command timed out", "unknown_result"],
    ["unrecognized error", "unknown"],
  ])("classifies %s as %s", (error, expected) => {
    expect(classifyGitFailure(error)).toBe(expected);
  });
});
