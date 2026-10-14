import { describe, expect, it } from "vitest";
import { classifyGitFailure } from "./git-recovery.js";
describe("Git failure recovery", () => {
  it.each([
    ["Authentication failed", "authentication"],
    ["Permission denied (publickey)", "authentication"],
    ["Write access to repository not granted", "permission"],
    ["[rejected] main -> main (non-fast-forward)", "remote_updates"],
    ["GH006: Protected branch update failed", "protected_branch"],
    ["Could not resolve host: github.com", "network"],
    ["Host key verification failed", "host_key"],
    ["pre-receive hook declined", "rules"],
    ["Git command timed out", "unknown_result"],
    ["unrecognized error", "unknown"],
  ])("classifies %s as %s", (error, expected) => {
    expect(classifyGitFailure(error)).toBe(expected);
  });
});
