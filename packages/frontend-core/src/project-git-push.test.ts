import { expect, it, vi } from "vitest";
import type { PushProjectCommitsRequest, PushProjectCommitsResponse } from "@codexly/protocol";
import {
  projectPushMutationOptions,
  shouldClearGitFailureAfterInspect,
} from "./project-git-push.js";

const checked: PushProjectCommitsResponse = {
  branch: "main",
  pushStatus: "checked",
  pushError: null,
  remoteState: {
    head: "b".repeat(40),
    upstream: "origin/main",
    remote: "origin",
    targetBranch: "main",
    remotes: [{ name: "origin", url: "local" }],
    ahead: 1,
    behind: 0,
    checkedAt: "2026-10-14T00:00:00Z",
    operation: "none",
    conflicts: [],
  },
};

it("clears an explicitly refreshed state change without erasing an unverified connection failure", () => {
  const remoteState = checked.remoteState;
  if (!remoteState) throw new Error("Missing checked remote state fixture");
  expect(shouldClearGitFailureAfterInspect("state_changed", checked)).toBe(true);
  expect(shouldClearGitFailureAfterInspect("network", checked)).toBe(false);
  expect(
    shouldClearGitFailureAfterInspect("state_changed", { ...checked, pushStatus: "failed" }),
  ).toBe(false);
  expect(
    shouldClearGitFailureAfterInspect("network", {
      ...checked,
      remoteState: { ...remoteState, ahead: 0, behind: 0 },
    }),
  ).toBe(true);
});

it.each(["push", "publish", "fetch"] as const)(
  "binds %s to freshly inspected HEAD instead of cached metadata",
  async (action) => {
    const pushProjectCommits = vi
      .fn<
        (
          project: string,
          root: string,
          request: PushProjectCommitsRequest,
        ) => Promise<PushProjectCommitsResponse>
      >()
      .mockResolvedValueOnce(checked)
      .mockResolvedValueOnce({ ...checked, pushStatus: "pushed" });
    const options = projectPushMutationOptions("p", "/repo", { pushProjectCommits });
    await options.mutationFn({ action, expectedSnapshot: "a".repeat(64), expectedBranch: "main" });
    expect(pushProjectCommits.mock.calls.map((call) => call[2])).toEqual([
      { action: "inspect", expectedSnapshot: "a".repeat(64) },
      {
        action,
        expectedSnapshot: "a".repeat(64),
        expectedBranch: "main",
        expectedHead: "b".repeat(40),
      },
    ]);
  },
);

it("refuses to push a different branch discovered during inspection", async () => {
  const pushProjectCommits = vi.fn().mockResolvedValue({ ...checked, branch: "other" });
  const options = projectPushMutationOptions("p", "/repo", { pushProjectCommits });
  await expect(
    options.mutationFn({
      action: "push",
      expectedSnapshot: "a".repeat(64),
      expectedBranch: "main",
    }),
  ).rejects.toThrow(/branch changed/iu);
  expect(pushProjectCommits).toHaveBeenCalledTimes(1);
});

it("preserves an explicitly requested HEAD guard", async () => {
  const pushProjectCommits = vi.fn().mockResolvedValue(checked);
  const options = projectPushMutationOptions("p", "/repo", { pushProjectCommits });
  await expect(
    options.mutationFn({
      action: "push",
      expectedSnapshot: "a".repeat(64),
      expectedBranch: "main",
      expectedHead: "c".repeat(40),
    }),
  ).rejects.toThrow(/branch changed/iu);
  expect(pushProjectCommits).toHaveBeenCalledTimes(1);
});

it("keeps the legacy push request intact without an extra inspection", async () => {
  const pushProjectCommits = vi.fn().mockResolvedValue({ ...checked, pushStatus: "pushed" });
  const options = projectPushMutationOptions("p", "/repo", { pushProjectCommits });
  const request = { expectedSnapshot: "a".repeat(64) };
  await options.mutationFn(request);
  expect(pushProjectCommits).toHaveBeenCalledExactlyOnceWith("p", "/repo", request);
});

it("leaves failures to the persistent workspace card without duplicate error toasts", () => {
  const options = projectPushMutationOptions("p", "/repo", { pushProjectCommits: vi.fn() });
  expect(options.meta.actionNotification).toBe(false);
});
