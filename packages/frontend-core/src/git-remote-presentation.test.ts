import { describe, expect, it } from "vitest";
import { deriveGitRemotePresentation } from "./git-remote-presentation.js";

const remote = {
  head: "a".repeat(40),
  upstream: "origin/main",
  remote: "origin",
  targetBranch: "main",
  remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
  ahead: 2,
  behind: 0,
  checkedAt: "2026-10-14T00:00:00Z",
  operation: "none" as const,
  conflicts: [],
};
const base = {
  branch: "main",
  remote,
  pushStatus: "checked",
  pushError: null,
  actionError: null,
  inspecting: false,
  hasActions: true,
  hasWorkingChanges: false,
};

describe("Git remote presentation", () => {
  it("does not claim readiness while remote status is unavailable", () => {
    const result = deriveGitRemotePresentation({ ...base, remote: undefined });
    expect(result.summaryKey).toBe("commit.remoteUnknown");
    expect(result.primary.action).toBe("inspect");
  });
  it("offers push for outgoing work and fetch after synchronization", () => {
    expect(deriveGitRemotePresentation(base).primary.action).toBe("push");
    const synced = deriveGitRemotePresentation({ ...base, remote: { ...remote, ahead: 0 } });
    expect(synced.primary.action).toBe("fetch");
    expect(synced.summaryKey).toBe("commit.synced");
  });
  it("chooses setup and publishing before any unsafe push retry", () => {
    const failed = { ...base, pushStatus: "not_configured", pushError: "no upstream" };
    expect(
      deriveGitRemotePresentation({ ...failed, remote: { ...remote, remotes: [] } }).primary.action,
    ).toBe("configure");
    expect(
      deriveGitRemotePresentation({ ...failed, remote: { ...remote, upstream: null } }).primary
        .action,
    ).toBe("publish");
  });
  it.each([
    ["Git status changed before the push", "inspect"],
    ["Failed to connect to github.com", "fetch"],
    ["protected branch hook declined", "branch"],
    ["invalid remote URL", "configure"],
  ])("makes the next action match the failure: %s", (pushError, action) => {
    const presentation = deriveGitRemotePresentation({ ...base, pushStatus: "failed", pushError });
    expect(presentation.primary.action).toBe(action);
    expect(presentation.failure).not.toBeNull();
  });
  it("hands an unfinished merge to external tools and only offers status refresh", () => {
    const result = deriveGitRemotePresentation({
      ...base,
      pushStatus: "failed",
      pushError: "merge conflicts",
      remote: { ...remote, operation: "merge", conflicts: ["app.ts"] },
    });
    expect(result.primary.action).toBe("inspect");
    expect(result.hintKey).toBe("commit.mergeExternalHelp");
    expect(result.failure).toBeNull();
    expect(
      deriveGitRemotePresentation({ ...base, remote: { ...remote, operation: "merge" } }).primary
        .action,
    ).toBe("inspect");
  });
  it("directs diverged histories to external Git tools instead of starting a merge", () => {
    const result = deriveGitRemotePresentation({ ...base, remote: { ...remote, behind: 1 } });
    expect(result.primary.action).toBe("inspect");
    expect(result.hintKey).toBe("commit.divergedExternalHelp");
  });
  it("keeps local AI failures independent of a valid push and blocks pull with working edits", () => {
    const local = deriveGitRemotePresentation({
      ...base,
      actionError: "AI unavailable",
      failureOperation: "generate",
    });
    expect(local.primary.action).toBe("push");
    expect(local.failure?.titleKey).toBe("commit.generateFailed");
    expect(
      deriveGitRemotePresentation({
        ...base,
        hasWorkingChanges: true,
        remote: { ...remote, ahead: 0, behind: 1 },
      }).primary.disabledReason,
    ).toBe("commit.pullNeedsCommit");
  });
});
